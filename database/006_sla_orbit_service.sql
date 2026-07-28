-- SLA monitoring and Orbit service integration.
-- Workflow definitions/records remain the catalog source of truth. Runtime
-- node instances provide the elapsed-time clock for each active step.

ALTER TABLE orbit_workflow.notification_template
    ADD COLUMN IF NOT EXISTS workflow_record_id uuid
        REFERENCES orbit_workflow.workflow_record(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS subject_xml text NOT NULL DEFAULT '<subject>{{step_name}} SLA notification</subject>',
    ADD COLUMN IF NOT EXISTS body_xml text NOT NULL DEFAULT '<body><p>{{step_name}} has an SLA event.</p>{{items_table}}</body>',
    ADD COLUMN IF NOT EXISTS stylesheet_css text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS access_url_template text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_template_workflow_record
    ON orbit_workflow.notification_template (workflow_record_id)
    WHERE workflow_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS orbit_workflow.workflow_email_template (
    workflow_record_id uuid PRIMARY KEY
        REFERENCES orbit_workflow.workflow_record(id) ON DELETE CASCADE,
    subject_xml text NOT NULL,
    body_xml text NOT NULL,
    stylesheet_css text NOT NULL DEFAULT '',
    access_url_template text NOT NULL DEFAULT '',
    is_active boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE orbit_workflow.workflow_email_template IS
    'Per-workflow-step XML email template and CSS. The step UUID is the lookup key.';

CREATE TABLE IF NOT EXISTS orbit_runtime.sla_notification (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_node_instance_id uuid NOT NULL
        REFERENCES orbit_runtime.workflow_node_instance(id) ON DELETE CASCADE,
    recipient varchar(320) NOT NULL,
    due_at timestamptz NOT NULL,
    subject text NOT NULL DEFAULT '',
    body text NOT NULL DEFAULT '',
    status varchar(16) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'sent', 'failed')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at timestamptz,
    error_message text,
    UNIQUE (workflow_node_instance_id, recipient, due_at)
);

CREATE OR REPLACE FUNCTION orbit_workflow.extract_sla_days(p_text text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
    v_match text[];
BEGIN
    v_match := regexp_match(
        lower(coalesce(p_text, '')),
        '([0-9]+([.][0-9]+)?)[[:space:]]*(个工作日|工作日|天|日|business[[:space:]]+days?|working[[:space:]]+days?|days?|day)'
    );
    IF v_match IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN v_match[1]::numeric;
END
$function$;

DROP FUNCTION IF EXISTS orbit_runtime.evaluate_sla_workflow_steps(uuid, timestamptz);
DROP FUNCTION IF EXISTS orbit_runtime.get_sla_workflow_steps(timestamptz, uuid);

CREATE OR REPLACE FUNCTION orbit_runtime.get_sla_workflow_steps(
    p_as_of timestamptz DEFAULT CURRENT_TIMESTAMP,
    p_workflow_step_id uuid DEFAULT NULL
)
RETURNS TABLE (
    workflow_step_id uuid,
    workflow_definition_id uuid,
    workflow_key varchar,
    workflow_instance_id uuid,
    workflow_node_instance_id uuid,
    record_key varchar,
    row_uuid uuid,
    business_key varchar,
    row_data jsonb,
    source_step_data jsonb,
    sla_text text,
    sla_days numeric,
    started_at timestamptz,
    due_at timestamptz,
    sla_violated boolean,
    recipient_email varchar,
    recipient_name varchar,
    business_entity varchar,
    business_rules jsonb,
    next_record_key varchar
)
LANGUAGE sql
STABLE
AS $function$
    SELECT r.id,
           w.id,
           w.workflow_key,
           i.id,
           n.id,
           r.record_key,
           i.id,
           i.business_key,
           i.context_json || jsonb_build_object('business_key', i.business_key),
           jsonb_build_object('label', coalesce(r.label_i18n ->> 'en', r.record_key)) || r.values_json,
           COALESCE(assignment.sla, r.values_json ->> 'time_limit'),
           orbit_workflow.extract_sla_days(COALESCE(assignment.sla, r.values_json ->> 'time_limit')),
           COALESCE(n.start_time, n.started_at, i.started_at),
           COALESCE(n.start_time, n.started_at, i.started_at)
             + make_interval(days => orbit_workflow.extract_sla_days(COALESCE(assignment.sla, r.values_json ->> 'time_limit'))::integer),
           coalesce(p_as_of, CURRENT_TIMESTAMP) >= COALESCE(n.start_time, n.started_at, i.started_at)
             + make_interval(days => orbit_workflow.extract_sla_days(COALESCE(assignment.sla, r.values_json ->> 'time_limit'))::integer),
           NULLIF(assignment.contact_email, ''),
           NULLIF(assignment.contact_name, ''),
           assignment.business_entity,
           jsonb_build_object(
               'business_alert_rules', COALESCE((
                   SELECT jsonb_agg(to_jsonb(rule) ORDER BY rule.record_order)
                     FROM orbit_workflow.business_alert_rule rule
                    WHERE rule.is_active AND COALESCE(rule.is_enabled, true)
               ), '[]'::jsonb),
               'customer_pool_rules', COALESCE((
                   SELECT jsonb_agg(to_jsonb(rule) ORDER BY rule.record_order)
                     FROM orbit_workflow.customer_pool_rule rule
                    WHERE rule.is_active
               ), '[]'::jsonb)
           ),
           next_step.record_key
      FROM orbit_runtime.workflow_node_instance n
      JOIN orbit_runtime.workflow_instance i ON i.id = n.instance_id
      JOIN orbit_workflow.workflow_definition w ON w.id = i.workflow_id
      JOIN orbit_workflow.workflow_record r
        ON r.workflow_id = i.workflow_id AND r.record_key = n.record_key
      LEFT JOIN orbit_workflow.workflow_step_assignment assignment
        ON assignment.workflow_record_id = r.id
      LEFT JOIN LATERAL (
          SELECT target.record_key
            FROM jsonb_array_elements(w.edges_json) edge
            JOIN orbit_workflow.workflow_record target
              ON target.workflow_id = w.id AND target.record_key = edge ->> 'target'
           WHERE edge ->> 'source' = r.record_key
           ORDER BY target.record_order
           LIMIT 1
      ) next_step ON true
     WHERE i.status IN ('active', 'waiting')
       AND n.status IN ('active', 'waiting')
       AND orbit_workflow.extract_sla_days(COALESCE(assignment.sla, r.values_json ->> 'time_limit')) IS NOT NULL
       AND (p_workflow_step_id IS NULL OR r.id = p_workflow_step_id)
$function$;

CREATE OR REPLACE FUNCTION orbit_runtime.evaluate_sla_workflow_steps(
    p_workflow_step_id uuid DEFAULT NULL,
    p_as_of timestamptz DEFAULT CURRENT_TIMESTAMP
)
RETURNS TABLE (
    workflow_step_id uuid,
    workflow_instance_id uuid,
    workflow_node_instance_id uuid,
    record_key varchar,
    business_entity varchar,
    sla_days numeric,
    sla_violated boolean,
    next_record_key varchar,
    business_rules jsonb,
    action varchar,
    reason varchar
)
LANGUAGE sql
STABLE
AS $function$
    SELECT s.workflow_step_id,
           s.workflow_instance_id,
           s.workflow_node_instance_id,
           s.record_key,
           s.business_entity,
           s.sla_days,
           s.sla_violated,
           s.next_record_key,
           s.business_rules,
           'TODO_RULE_EVALUATION'::varchar,
           'Business rules are loaded from the origin catalog; rule evaluation and transition remain TODO.'::varchar
      FROM orbit_runtime.get_sla_workflow_steps(p_as_of, p_workflow_step_id) s
$function$;

CREATE OR REPLACE FUNCTION orbit_workflow.get_email_template(p_workflow_step_id uuid)
RETURNS TABLE (
    subject_xml text,
    body_xml text,
    stylesheet_css text,
    access_url_template text
)
LANGUAGE sql
STABLE
AS $function$
    SELECT coalesce(custom.subject_xml, nt.subject_xml, '<subject>{{step_name}} SLA notification</subject>'),
           coalesce(custom.body_xml, nt.body_xml, '<body><p>{{step_name}} has an SLA event.</p>{{items_table}}</body>'),
           coalesce(custom.stylesheet_css, nt.stylesheet_css, ''),
           coalesce(custom.access_url_template, nt.access_url_template, '')
      FROM (SELECT 1) seed
      LEFT JOIN orbit_workflow.workflow_email_template custom
        ON custom.workflow_record_id = p_workflow_step_id AND custom.is_active
      LEFT JOIN orbit_workflow.notification_template nt
        ON nt.workflow_record_id = p_workflow_step_id AND nt.is_active
$function$;

CREATE OR REPLACE FUNCTION orbit_runtime.claim_sla_notification(
    p_workflow_node_instance_id uuid,
    p_recipient varchar,
    p_due_at timestamptz,
    p_subject text,
    p_body text
)
RETURNS uuid
LANGUAGE sql
AS $function$
    INSERT INTO orbit_runtime.sla_notification (
        workflow_node_instance_id, recipient, due_at, subject, body
    )
    VALUES (p_workflow_node_instance_id, p_recipient, p_due_at, p_subject, p_body)
    ON CONFLICT (workflow_node_instance_id, recipient, due_at) DO UPDATE
       SET status = 'queued', subject = EXCLUDED.subject, body = EXCLUDED.body,
           error_message = NULL
     WHERE orbit_runtime.sla_notification.status = 'failed'
    RETURNING id
$function$;

CREATE OR REPLACE FUNCTION orbit_runtime.finish_sla_notification(
    p_notification_id uuid,
    p_status varchar,
    p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
AS $function$
    UPDATE orbit_runtime.sla_notification
       SET status = p_status,
           sent_at = CASE WHEN p_status = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END,
           error_message = p_error_message
     WHERE id = p_notification_id
$function$;
