-- Store SLA days as numeric values instead of free-form text.
-- Existing values such as "5个工作日内" are reduced to 5; invalid or
-- sub-day values are cleared so they cannot enter the numeric columns.

UPDATE orbit_workflow.workflow_step_assignment
   SET sla = orbit_workflow.extract_sla_days(sla)::text
 WHERE sla IS NOT NULL;

UPDATE orbit_workflow.workflow_record
   SET values_json = jsonb_set(
         values_json,
         '{time_limit}',
         to_jsonb(orbit_workflow.extract_sla_days(values_json ->> 'time_limit')),
         true
       )
 WHERE values_json ? 'time_limit'
   AND orbit_workflow.extract_sla_days(values_json ->> 'time_limit') IS NOT NULL;

ALTER TABLE orbit_workflow.workflow_step_assignment
    ALTER COLUMN sla TYPE numeric(10, 2)
    USING CASE
        WHEN sla IS NULL OR trim(sla) = '' THEN NULL
        ELSE sla::numeric
    END;

DO $block$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'ck_workflow_step_assignment_sla_days'
           AND conrelid = 'orbit_workflow.workflow_step_assignment'::regclass
    ) THEN
        ALTER TABLE orbit_workflow.workflow_step_assignment
            ADD CONSTRAINT ck_workflow_step_assignment_sla_days
            CHECK (sla IS NULL OR sla >= 1);
    END IF;
END
$block$;

-- Catalog lookup rows have localized display text in sla_i18n; the canonical
-- sla column is numeric for joins, exports, and future API consumers.
DELETE FROM orbit_workflow.sla_lookup
 WHERE orbit_workflow.extract_sla_days(sla) IS NULL;

ALTER TABLE orbit_workflow.sla_lookup
    ALTER COLUMN sla TYPE numeric(10, 2)
    USING orbit_workflow.extract_sla_days(sla);
