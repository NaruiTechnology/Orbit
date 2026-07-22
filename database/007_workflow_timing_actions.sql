-- Workflow step timing and action audit fields.
-- started_at/completed_at remain for compatibility with existing clients;
-- the *_time fields are the explicit workflow-step trace interface.

DO $block$
BEGIN
    CREATE TYPE orbit_runtime.workflow_action_type AS ENUM (
        'notification_email',
        'system_task',
        'workflow_transition',
        'manual_action'
    );
EXCEPTION WHEN duplicate_object THEN
    NULL;
END
$block$;

ALTER TABLE orbit_runtime.workflow_node_instance
    ADD COLUMN IF NOT EXISTS start_time timestamptz,
    ADD COLUMN IF NOT EXISTS complete_time timestamptz,
    ADD COLUMN IF NOT EXISTS action_time timestamptz,
    ADD COLUMN IF NOT EXISTS action_type orbit_runtime.workflow_action_type;

UPDATE orbit_runtime.workflow_node_instance
   SET start_time = COALESCE(start_time, started_at),
       complete_time = COALESCE(complete_time, completed_at)
 WHERE start_time IS NULL OR complete_time IS NULL;

CREATE TABLE IF NOT EXISTS orbit_runtime.workflow_node_action (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_node_instance_id uuid NOT NULL
        REFERENCES orbit_runtime.workflow_node_instance(id) ON DELETE CASCADE,
    action_type orbit_runtime.workflow_action_type NOT NULL,
    action_key varchar(300) NOT NULL,
    action_time timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(payload) = 'object'),
    UNIQUE (workflow_node_instance_id, action_type, action_key)
);

CREATE INDEX IF NOT EXISTS ix_workflow_node_action_time
    ON orbit_runtime.workflow_node_action (workflow_node_instance_id, action_time DESC);

CREATE OR REPLACE FUNCTION orbit_runtime.touch_workflow_node_timing()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'active' THEN
            NEW.start_time = COALESCE(NEW.start_time, NEW.started_at, CURRENT_TIMESTAMP);
        END IF;
        IF NEW.status IN ('completed', 'cancelled', 'skipped') THEN
            NEW.complete_time = COALESCE(NEW.complete_time, NEW.completed_at, CURRENT_TIMESTAMP);
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
        NEW.start_time = COALESCE(NEW.start_time, NEW.started_at, CURRENT_TIMESTAMP);
    END IF;
    IF NEW.status IN ('completed', 'cancelled', 'skipped')
       AND OLD.status NOT IN ('completed', 'cancelled', 'skipped') THEN
        NEW.complete_time = COALESCE(NEW.complete_time, NEW.completed_at, CURRENT_TIMESTAMP);
    END IF;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_workflow_node_timing ON orbit_runtime.workflow_node_instance;
CREATE TRIGGER trg_workflow_node_timing
BEFORE INSERT OR UPDATE ON orbit_runtime.workflow_node_instance
FOR EACH ROW EXECUTE FUNCTION orbit_runtime.touch_workflow_node_timing();

CREATE OR REPLACE FUNCTION orbit_runtime.record_workflow_action(
    p_workflow_node_instance_id uuid,
    p_action_type orbit_runtime.workflow_action_type,
    p_action_key varchar,
    p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
DECLARE
    v_action_id uuid;
BEGIN
    INSERT INTO orbit_runtime.workflow_node_action (
        workflow_node_instance_id, action_type, action_key, payload
    )
    VALUES (
        p_workflow_node_instance_id, p_action_type, p_action_key,
        COALESCE(p_payload, '{}'::jsonb)
    )
    ON CONFLICT (workflow_node_instance_id, action_type, action_key) DO NOTHING
    RETURNING id INTO v_action_id;

    IF v_action_id IS NULL THEN
        RETURN false;
    END IF;

    UPDATE orbit_runtime.workflow_node_instance
       SET action_time = CURRENT_TIMESTAMP,
           action_type = p_action_type
     WHERE id = p_workflow_node_instance_id;
    RETURN true;
END
$function$;
