-- Durable per-node runtime projection.  workflow_record remains the immutable
-- catalog graph; this table stores the state of each node for one instance.
ALTER TABLE orbit_runtime.workflow_instance
    ADD COLUMN IF NOT EXISTS catalog_version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS orbit_runtime.workflow_node_instance (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id uuid NOT NULL REFERENCES orbit_runtime.workflow_instance(id) ON DELETE CASCADE,
    record_key varchar(140) NOT NULL,
    status varchar(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'waiting', 'completed', 'failed', 'blocked', 'cancelled', 'skipped')),
    completion_source varchar(16)
        CHECK (completion_source IS NULL OR completion_source IN ('system', 'user')),
    assigned_role_id uuid REFERENCES orbit_identity.role(id) ON DELETE SET NULL,
    assigned_user_id uuid REFERENCES orbit_identity.app_user(id) ON DELETE SET NULL,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    input_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input_json) = 'object'),
    output_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(output_json) = 'object'),
    error_code varchar(100),
    error_message text,
    started_at timestamptz,
    completed_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (instance_id, record_key)
);

CREATE INDEX IF NOT EXISTS ix_workflow_node_instance_status
    ON orbit_runtime.workflow_node_instance (instance_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS ux_workflow_task_open_node
    ON orbit_runtime.workflow_task (instance_id, record_key)
    WHERE state IN ('open', 'claimed');

CREATE TABLE IF NOT EXISTS orbit_runtime.notification_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id uuid NOT NULL REFERENCES orbit_runtime.workflow_instance(id) ON DELETE CASCADE,
    record_key varchar(140) NOT NULL,
    recipient varchar(320) NOT NULL,
    subject text NOT NULL DEFAULT '',
    body text NOT NULL DEFAULT '',
    status varchar(16) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'sent', 'failed', 'cancelled')),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at timestamptz,
    error_message text
);

CREATE INDEX IF NOT EXISTS ix_notification_outbox_status
    ON orbit_runtime.notification_outbox (status, created_at);

DROP TRIGGER IF EXISTS trg_workflow_node_instance_touch ON orbit_runtime.workflow_node_instance;
CREATE TRIGGER trg_workflow_node_instance_touch
BEFORE UPDATE ON orbit_runtime.workflow_node_instance
FOR EACH ROW EXECUTE FUNCTION orbit_workflow.touch_versioned_row();

COMMENT ON TABLE orbit_runtime.workflow_node_instance IS
    'Durable runtime state for each catalog node in a workflow instance.';
