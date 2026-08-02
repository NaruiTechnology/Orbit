-- Separate the configured notification template (notifyType) from the
-- per-step notification state (notifyAction).
ALTER TABLE orbit_workflow.workflow_step_assignment
    ADD COLUMN IF NOT EXISTS "notifyType" integer;

-- 011 used notifyAction for the template key. Preserve that data before
-- changing notifyAction to the nullable boolean state used by the UI/service.
DO $block$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'orbit_workflow'
           AND table_name = 'workflow_step_assignment'
           AND column_name = 'notifyAction'
           AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        EXECUTE 'UPDATE orbit_workflow.workflow_step_assignment
                    SET "notifyType" = "notifyAction"
                  WHERE "notifyType" IS NULL';
    END IF;
END
$block$;

ALTER TABLE orbit_workflow.workflow_step_assignment
    DROP CONSTRAINT IF EXISTS workflow_step_assignment_notify_action_check,
    DROP CONSTRAINT IF EXISTS workflow_step_assignment_notify_type_check;

DO $block$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'orbit_workflow'
           AND table_name = 'workflow_step_assignment'
           AND column_name = 'notifyAction'
           AND data_type <> 'boolean'
    ) THEN
        ALTER TABLE orbit_workflow.workflow_step_assignment
            ALTER COLUMN "notifyAction" TYPE boolean
            USING CASE WHEN "notifyAction" IS NULL THEN NULL ELSE false END;
    END IF;
END
$block$;

ALTER TABLE orbit_workflow.workflow_step_assignment
    ADD CONSTRAINT workflow_step_assignment_notify_type_check
    CHECK ("notifyType" IS NULL OR "notifyType" BETWEEN 1 AND 53);

CREATE INDEX IF NOT EXISTS ix_workflow_step_assignment_notify_type
    ON orbit_workflow.workflow_step_assignment ("notifyType");
