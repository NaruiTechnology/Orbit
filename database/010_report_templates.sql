-- DocumentAction state and persisted report output for workflow steps.
-- Preserve the camelCase interface name in PostgreSQL with a quoted identifier.
DO $block$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'orbit_workflow'
           AND table_name = 'workflow_step_assignment'
           AND column_name = 'action'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'orbit_workflow'
               AND table_name = 'workflow_step_assignment'
               AND column_name = 'documentAction'
        ) THEN
            ALTER TABLE orbit_workflow.workflow_step_assignment
                RENAME COLUMN action TO "documentAction";
        ELSE
            UPDATE orbit_workflow.workflow_step_assignment
               SET "documentAction" = action
             WHERE "documentAction" IS NULL;
            ALTER TABLE orbit_workflow.workflow_step_assignment
                DROP COLUMN action;
        END IF;
    END IF;
END
$block$;

ALTER TABLE orbit_workflow.workflow_step_assignment
    ADD COLUMN IF NOT EXISTS "documentAction" boolean DEFAULT NULL;

ALTER TABLE orbit_workflow.workflow_step_assignment
    ADD COLUMN IF NOT EXISTS "decisionAction" boolean NOT NULL DEFAULT false;

-- Existing configured steps require an action report before they can be
-- completed. New/unconfigured steps remain NULL until a business entity is set.
UPDATE orbit_workflow.workflow_step_assignment
   SET "documentAction" = false
 WHERE business_entity IS NOT NULL AND "documentAction" IS NULL;

CREATE TABLE IF NOT EXISTS orbit_workflow.workflow_step_report (
    workflow_record_id uuid PRIMARY KEY
        REFERENCES orbit_workflow.workflow_record(id) ON DELETE CASCADE,
    workflow_key varchar(140) NOT NULL,
    source_xml text NOT NULL,
    document_html text NOT NULL,
    content_type varchar(80) NOT NULL DEFAULT 'text/html',
    created_by uuid REFERENCES orbit_identity.app_user(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_workflow_step_report_workflow
    ON orbit_workflow.workflow_step_report (workflow_key, updated_at DESC);
