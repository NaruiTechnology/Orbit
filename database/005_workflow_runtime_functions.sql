-- PostgreSQL-owned workflow runtime mutations.
-- API/application services call these functions so state transitions are
-- transactional and reusable for every catalog-driven workflow.

CREATE OR REPLACE FUNCTION orbit_runtime.ensure_workflow_node_instances(
    p_instance_id uuid, p_workflow_id uuid, p_current_record_key varchar
) RETURNS void
LANGUAGE sql AS $function$
    INSERT INTO orbit_runtime.workflow_node_instance (instance_id, record_key, status, started_at)
    SELECT p_instance_id, r.record_key,
           CASE WHEN r.record_key = p_current_record_key THEN 'active' ELSE 'pending' END,
           CASE WHEN r.record_key = p_current_record_key THEN CURRENT_TIMESTAMP ELSE NULL END
      FROM orbit_workflow.workflow_record r
     WHERE r.workflow_id = p_workflow_id
    ON CONFLICT (instance_id, record_key) DO NOTHING
$function$;

CREATE OR REPLACE FUNCTION orbit_runtime.start_workflow_instance(
    p_workflow_id uuid, p_business_key varchar, p_context jsonb,
    p_organization_id uuid, p_department_id uuid, p_laboratory_id uuid,
    p_started_by uuid, p_catalog_version integer
) RETURNS orbit_runtime.workflow_instance
LANGUAGE plpgsql AS $function$
DECLARE
    v_instance orbit_runtime.workflow_instance;
    v_first varchar(140);
BEGIN
    SELECT record_key INTO v_first
      FROM orbit_workflow.workflow_record
     WHERE workflow_id = p_workflow_id
     ORDER BY record_order LIMIT 1;

    INSERT INTO orbit_runtime.workflow_instance (
        workflow_id, business_key, current_record_key, status, context_json,
        organization_id, department_id, laboratory_id, started_by, catalog_version
    ) VALUES (
        p_workflow_id, p_business_key, v_first, 'active', p_context,
        p_organization_id, p_department_id, p_laboratory_id, p_started_by, p_catalog_version
    ) RETURNING * INTO v_instance;

    INSERT INTO orbit_runtime.transition_event
        (instance_id, from_record_key, to_record_key, outcome, payload, actor_user_id)
    VALUES (v_instance.id, NULL, v_first, 'start', p_context, p_started_by);

    INSERT INTO orbit_runtime.workflow_node_instance (instance_id, record_key, status, started_at)
    SELECT v_instance.id, r.record_key,
           CASE WHEN r.record_key = v_first THEN 'active' ELSE 'pending' END,
           CASE WHEN r.record_key = v_first THEN CURRENT_TIMESTAMP ELSE NULL END
      FROM orbit_workflow.workflow_record r
     WHERE r.workflow_id = p_workflow_id
    ON CONFLICT (instance_id, record_key) DO NOTHING;

    IF v_first IS NOT NULL THEN
        INSERT INTO orbit_runtime.workflow_task (instance_id, record_key, state, payload)
        VALUES (v_instance.id, v_first, 'open', p_context)
        ON CONFLICT (instance_id, record_key) WHERE state IN ('open', 'claimed') DO NOTHING;
    END IF;
    RETURN v_instance;
END
$function$;

CREATE OR REPLACE FUNCTION orbit_runtime.transition_workflow_instance(
    p_instance_id uuid, p_expected_version integer, p_target_record_key varchar,
    p_outcome varchar, p_payload jsonb, p_actor_user_id uuid
) RETURNS orbit_runtime.workflow_instance
LANGUAGE plpgsql AS $function$
DECLARE
    v_instance orbit_runtime.workflow_instance;
    v_edges jsonb;
    v_from varchar(140);
    v_target varchar(140);
BEGIN
    SELECT i.*
      INTO v_instance
      FROM orbit_runtime.workflow_instance i
      JOIN orbit_workflow.workflow_definition w ON w.id = i.workflow_id
     WHERE i.id = p_instance_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Workflow instance not found' USING ERRCODE = 'P0002';
    END IF;
    SELECT edges_json INTO v_edges
      FROM orbit_workflow.workflow_definition
     WHERE id = v_instance.workflow_id;
    v_from := v_instance.current_record_key;
    IF v_instance.status NOT IN ('active', 'waiting') THEN
        RAISE EXCEPTION 'Workflow instance is not active' USING ERRCODE = '55000';
    END IF;

    SELECT edge->>'target' INTO v_target
      FROM jsonb_array_elements(v_edges) edge
     WHERE edge->>'source' = v_from
       AND (edge->>'outcome' IS NULL OR edge->>'outcome' = p_outcome OR p_outcome = 'complete')
     ORDER BY CASE WHEN edge->>'outcome' = p_outcome THEN 0 ELSE 1 END
     LIMIT 1;

    IF p_target_record_key IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_edges) edge
             WHERE edge->>'source' = v_from AND edge->>'target' = p_target_record_key
        ) THEN
            RAISE EXCEPTION 'Target is not a valid workflow edge' USING ERRCODE = '22023';
        END IF;
        v_target := p_target_record_key;
    END IF;

    UPDATE orbit_runtime.workflow_instance
       SET current_record_key = v_target,
           status = CASE WHEN v_target IS NULL THEN 'completed' ELSE 'active' END,
           context_json = context_json || p_payload,
           completed_at = CASE WHEN v_target IS NULL THEN CURRENT_TIMESTAMP ELSE NULL END
     WHERE id = p_instance_id AND version = p_expected_version
     RETURNING * INTO v_instance;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Instance version is stale' USING ERRCODE = '40001';
    END IF;

    UPDATE orbit_runtime.workflow_node_instance
       SET status = 'completed', completion_source = 'user',
           completed_at = CURRENT_TIMESTAMP, output_json = output_json || p_payload
     WHERE instance_id = p_instance_id AND record_key = v_from;

    UPDATE orbit_runtime.workflow_task
       SET state = 'completed', completed_at = CURRENT_TIMESTAMP
     WHERE instance_id = p_instance_id AND record_key = v_from
       AND state IN ('open', 'claimed');

    IF v_target IS NOT NULL THEN
        UPDATE orbit_runtime.workflow_node_instance
           SET status = 'active', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
         WHERE instance_id = p_instance_id AND record_key = v_target;
        INSERT INTO orbit_runtime.workflow_task (instance_id, record_key, state, payload)
        VALUES (p_instance_id, v_target, 'open', p_payload)
        ON CONFLICT (instance_id, record_key) WHERE state IN ('open', 'claimed') DO NOTHING;
    END IF;

    INSERT INTO orbit_runtime.transition_event
        (instance_id, from_record_key, to_record_key, outcome, payload, actor_user_id)
    VALUES (p_instance_id, v_from, v_target, p_outcome, p_payload, p_actor_user_id);
    RETURN v_instance;
END
$function$;

CREATE OR REPLACE FUNCTION orbit_runtime.cancel_workflow_instance(
    p_instance_id uuid, p_expected_version integer, p_record_key varchar,
    p_reason text, p_actor_user_id uuid, p_outcome varchar
) RETURNS orbit_runtime.workflow_instance
LANGUAGE plpgsql AS $function$
DECLARE v_instance orbit_runtime.workflow_instance;
BEGIN
    UPDATE orbit_runtime.workflow_instance
       SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP,
           context_json = context_json || jsonb_build_object('cancel_reason', p_reason)
     WHERE id = p_instance_id AND version = p_expected_version
       AND status IN ('active', 'waiting', 'failed')
     RETURNING * INTO v_instance;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Instance version is stale or not cancellable' USING ERRCODE = '40001';
    END IF;

    UPDATE orbit_runtime.workflow_node_instance
       SET status = 'cancelled', error_code = upper(p_outcome),
           error_message = p_reason, completed_at = CURRENT_TIMESTAMP
     WHERE instance_id = p_instance_id AND record_key = p_record_key;

    -- An abort is terminal, but the workflow should not retain completed-step
    -- footprints from a previous run. Reset nodes before the aborted step so
    -- the runtime projection renders them as untouched/upcoming.
    UPDATE orbit_runtime.workflow_node_instance n
       SET status = 'pending', completion_source = NULL, attempt_count = 0,
           output_json = '{}'::jsonb, error_code = NULL, error_message = NULL,
           started_at = NULL, completed_at = NULL, start_time = NULL,
           complete_time = NULL, action_time = NULL, action_type = NULL
      FROM orbit_workflow.workflow_record r,
           orbit_workflow.workflow_record current_record,
           orbit_runtime.workflow_instance i
     WHERE n.instance_id = p_instance_id
       AND n.record_key = r.record_key
       AND i.id = p_instance_id
       AND current_record.workflow_id = i.workflow_id
       AND current_record.record_key = p_record_key
       AND r.workflow_id = i.workflow_id
       AND r.record_order < current_record.record_order;
    UPDATE orbit_runtime.workflow_task
       SET state = 'cancelled', completed_at = CURRENT_TIMESTAMP
     WHERE instance_id = p_instance_id AND record_key = p_record_key
       AND state IN ('open', 'claimed');
    INSERT INTO orbit_runtime.transition_event
        (instance_id, from_record_key, to_record_key, outcome, payload, actor_user_id)
    VALUES (p_instance_id, p_record_key, NULL, p_outcome,
            jsonb_build_object('reason', p_reason), p_actor_user_id);
    RETURN v_instance;
END
$function$;

CREATE OR REPLACE FUNCTION orbit_runtime.block_workflow_node(
    p_instance_id uuid, p_expected_version integer, p_record_key varchar,
    p_outcome varchar, p_reason text, p_actor_user_id uuid
) RETURNS orbit_runtime.workflow_instance
LANGUAGE plpgsql AS $function$
DECLARE v_instance orbit_runtime.workflow_instance;
BEGIN
    UPDATE orbit_runtime.workflow_instance
       SET status = 'waiting', completed_at = NULL,
           context_json = context_json || jsonb_build_object('exception_reason', p_reason)
     WHERE id = p_instance_id AND version = p_expected_version
       AND status IN ('active', 'waiting')
     RETURNING * INTO v_instance;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Instance version is stale or not active' USING ERRCODE = '40001';
    END IF;

    UPDATE orbit_runtime.workflow_node_instance
       SET status = 'blocked', error_code = upper(p_outcome), error_message = p_reason
     WHERE instance_id = p_instance_id AND record_key = p_record_key;
    INSERT INTO orbit_runtime.transition_event
        (instance_id, from_record_key, to_record_key, outcome, payload, actor_user_id)
    VALUES (p_instance_id, p_record_key, p_record_key, p_outcome,
            jsonb_build_object('reason', p_reason), p_actor_user_id);
    RETURN v_instance;
END
$function$;

CREATE OR REPLACE FUNCTION orbit_runtime.resume_workflow_node(
    p_instance_id uuid, p_expected_version integer, p_record_key varchar, p_payload jsonb
) RETURNS orbit_runtime.workflow_instance
LANGUAGE plpgsql AS $function$
DECLARE v_instance orbit_runtime.workflow_instance;
BEGIN
    UPDATE orbit_runtime.workflow_instance
       SET status = 'active', completed_at = NULL
     WHERE id = p_instance_id AND version = p_expected_version
       AND status IN ('active', 'waiting', 'failed')
     RETURNING * INTO v_instance;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Instance version is stale or not retryable' USING ERRCODE = '40001';
    END IF;

    UPDATE orbit_runtime.workflow_node_instance
       SET status = 'active', attempt_count = attempt_count + 1,
           error_code = NULL, error_message = NULL,
           started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
     WHERE instance_id = p_instance_id AND record_key = p_record_key
       AND status IN ('failed', 'blocked');
    INSERT INTO orbit_runtime.workflow_task (instance_id, record_key, state, payload)
    VALUES (p_instance_id, p_record_key, 'open', p_payload)
    ON CONFLICT (instance_id, record_key) WHERE state IN ('open', 'claimed') DO NOTHING;
    RETURN v_instance;
END
$function$;

CREATE OR REPLACE FUNCTION orbit_runtime.queue_workflow_notification(
    p_instance_id uuid, p_record_key varchar, p_recipient varchar,
    p_subject text, p_body text, p_payload jsonb, p_actor_user_id uuid
) RETURNS void
LANGUAGE plpgsql AS $function$
BEGIN
    INSERT INTO orbit_runtime.notification_outbox
        (instance_id, record_key, recipient, subject, body, payload)
    VALUES (p_instance_id, p_record_key, p_recipient, p_subject, p_body, p_payload);
    INSERT INTO orbit_runtime.transition_event
        (instance_id, from_record_key, to_record_key, outcome, payload, actor_user_id)
    VALUES (p_instance_id, p_record_key, p_record_key, 'email_queued', p_payload, p_actor_user_id);
END
$function$;

CREATE OR REPLACE FUNCTION orbit_runtime.claim_system_workflow_tasks(p_limit integer DEFAULT 20)
RETURNS TABLE (
    task_id uuid, instance_id uuid, workflow_id uuid, record_key varchar,
    current_record_key varchar, instance_version integer, started_by uuid,
    edges_json jsonb, values_json jsonb, payload jsonb
)
LANGUAGE sql AS $function$
    WITH candidates AS (
        SELECT t.id, t.instance_id, i.workflow_id, i.current_record_key,
               i.version AS instance_version, i.started_by, w.edges_json,
               r.record_key, r.values_json
          FROM orbit_runtime.workflow_task t
          JOIN orbit_runtime.workflow_instance i ON i.id = t.instance_id
          JOIN orbit_workflow.workflow_definition w ON w.id = i.workflow_id
          JOIN orbit_workflow.workflow_record r
            ON r.workflow_id = i.workflow_id AND r.record_key = t.record_key
         WHERE t.state = 'open'
           AND r.values_json->>'owner_role' IN ('系统', 'System')
           AND i.status IN ('active', 'waiting')
         ORDER BY t.created_at
         FOR UPDATE OF t SKIP LOCKED
         LIMIT GREATEST(p_limit, 1)
    ), claimed AS (
        UPDATE orbit_runtime.workflow_task t
           SET state = 'claimed'
          FROM candidates c
         WHERE t.id = c.id AND t.state = 'open'
        RETURNING t.id AS task_id, t.instance_id, c.workflow_id, c.record_key,
                  c.current_record_key, c.instance_version, c.started_by,
                  c.edges_json, c.values_json, t.payload
    )
    SELECT * FROM claimed
$function$;

CREATE OR REPLACE FUNCTION orbit_runtime.complete_system_workflow_task(
    p_task_id uuid, p_output jsonb
) RETURNS orbit_runtime.workflow_instance
LANGUAGE plpgsql AS $function$
DECLARE
    v_task record;
    v_instance orbit_runtime.workflow_instance;
    v_target varchar(140);
BEGIN
    SELECT t.*, i.workflow_id, i.current_record_key, i.version AS instance_version,
           i.started_by, w.edges_json
      INTO v_task
      FROM orbit_runtime.workflow_task t
      JOIN orbit_runtime.workflow_instance i ON i.id = t.instance_id
      JOIN orbit_workflow.workflow_definition w ON w.id = i.workflow_id
     WHERE t.id = p_task_id AND t.state = 'claimed'
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claimed workflow task not found' USING ERRCODE = 'P0002';
    END IF;

    SELECT edge->>'target' INTO v_target
      FROM jsonb_array_elements(v_task.edges_json) edge
     WHERE edge->>'source' = v_task.record_key
     ORDER BY 1 LIMIT 1;

    UPDATE orbit_runtime.workflow_instance
       SET current_record_key = v_target,
           status = CASE WHEN v_target IS NULL THEN 'completed' ELSE 'active' END,
           completed_at = CASE WHEN v_target IS NULL THEN CURRENT_TIMESTAMP ELSE NULL END
     WHERE id = v_task.instance_id AND version = v_task.instance_version
     RETURNING * INTO v_instance;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Workflow instance changed while system task was executing'
            USING ERRCODE = '40001';
    END IF;

    UPDATE orbit_runtime.workflow_node_instance
       SET status = 'completed', completion_source = 'system',
           output_json = output_json || p_output, completed_at = CURRENT_TIMESTAMP
     WHERE instance_id = v_task.instance_id AND record_key = v_task.record_key;
    UPDATE orbit_runtime.workflow_task
       SET state = 'completed', payload = payload || p_output, completed_at = CURRENT_TIMESTAMP
     WHERE id = p_task_id;
    IF v_target IS NOT NULL THEN
        UPDATE orbit_runtime.workflow_node_instance
           SET status = 'active', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
         WHERE instance_id = v_task.instance_id AND record_key = v_target;
        INSERT INTO orbit_runtime.workflow_task (instance_id, record_key, state, payload)
        VALUES (v_task.instance_id, v_target, 'open', p_output)
        ON CONFLICT (instance_id, record_key) WHERE state IN ('open', 'claimed') DO NOTHING;
    END IF;
    INSERT INTO orbit_runtime.transition_event
        (instance_id, from_record_key, to_record_key, outcome, payload, actor_user_id)
    VALUES (v_task.instance_id, v_task.record_key, v_target, 'system_complete',
            p_output, v_task.started_by);
    RETURN v_instance;
END
$function$;

CREATE OR REPLACE FUNCTION orbit_runtime.fail_system_workflow_task(
    p_task_id uuid, p_error_message text
) RETURNS void
LANGUAGE plpgsql AS $function$
DECLARE v_task record;
BEGIN
    SELECT t.*, i.version AS instance_version, i.started_by
      INTO v_task
      FROM orbit_runtime.workflow_task t
      JOIN orbit_runtime.workflow_instance i ON i.id = t.instance_id
     WHERE t.id = p_task_id AND t.state = 'claimed'
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claimed workflow task not found' USING ERRCODE = 'P0002';
    END IF;

    UPDATE orbit_runtime.workflow_instance
       SET status = 'failed'
     WHERE id = v_task.instance_id AND version = v_task.instance_version;
    UPDATE orbit_runtime.workflow_node_instance
       SET status = 'failed', error_code = 'SYSTEM_TASK_FAILED',
           error_message = p_error_message
     WHERE instance_id = v_task.instance_id AND record_key = v_task.record_key;
    UPDATE orbit_runtime.workflow_task
       SET state = 'completed',
           payload = payload || jsonb_build_object(
               'error_code', 'SYSTEM_TASK_FAILED', 'error_message', p_error_message
           ),
           completed_at = CURRENT_TIMESTAMP
     WHERE id = p_task_id;
    INSERT INTO orbit_runtime.transition_event
        (instance_id, from_record_key, to_record_key, outcome, payload, actor_user_id)
    VALUES (v_task.instance_id, v_task.record_key, v_task.record_key, 'system_failed',
            jsonb_build_object('error_code', 'SYSTEM_TASK_FAILED',
                               'error_message', p_error_message), v_task.started_by);
END
$function$;


CREATE OR REPLACE FUNCTION orbit_runtime.update_workflow_instance_record(
    p_instance_id uuid, p_expected_version integer,
    p_business_key varchar, p_status varchar, p_context jsonb
) RETURNS orbit_runtime.workflow_instance
LANGUAGE plpgsql AS $function$
DECLARE v_instance orbit_runtime.workflow_instance;
BEGIN
    UPDATE orbit_runtime.workflow_instance
       SET business_key = COALESCE(p_business_key, business_key),
           status = COALESCE(p_status, status),
           context_json = COALESCE(p_context, context_json)
     WHERE id = p_instance_id AND version = p_expected_version
     RETURNING * INTO v_instance;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Workflow instance version is stale' USING ERRCODE = '40001';
    END IF;
    RETURN v_instance;
END
$function$;

CREATE OR REPLACE FUNCTION orbit_runtime.create_workflow_instance_record(
    p_workflow_id uuid, p_business_key varchar, p_status varchar,
    p_context jsonb, p_organization_id uuid, p_department_id uuid,
    p_laboratory_id uuid, p_started_by uuid, p_catalog_version integer
) RETURNS orbit_runtime.workflow_instance
LANGUAGE plpgsql AS $function$
DECLARE v_instance orbit_runtime.workflow_instance;
DECLARE v_first varchar(140);
BEGIN
    SELECT record_key INTO v_first
      FROM orbit_workflow.workflow_record
     WHERE workflow_id = p_workflow_id
     ORDER BY record_order LIMIT 1;
    INSERT INTO orbit_runtime.workflow_instance (
        workflow_id, business_key, current_record_key, status, context_json,
        organization_id, department_id, laboratory_id, started_by, catalog_version
    ) VALUES (
        p_workflow_id, p_business_key, v_first, p_status, p_context,
        p_organization_id, p_department_id, p_laboratory_id,
        p_started_by, p_catalog_version
    ) RETURNING * INTO v_instance;
    RETURN v_instance;
END
$function$;

CREATE OR REPLACE FUNCTION orbit_runtime.delete_workflow_instance_record(
    p_instance_id uuid, p_workflow_key varchar, p_organization_id uuid
) RETURNS uuid
LANGUAGE plpgsql AS $function$
DECLARE v_id uuid;
BEGIN
    DELETE FROM orbit_runtime.workflow_instance i
     USING orbit_workflow.workflow_definition w
     WHERE i.id = p_instance_id AND i.workflow_id = w.id
       AND w.workflow_key = p_workflow_key
       AND i.organization_id = p_organization_id
    RETURNING i.id INTO v_id;
    RETURN v_id;
END
$function$;
