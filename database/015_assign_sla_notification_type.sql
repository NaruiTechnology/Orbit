-- Existing SLA assignments imported before notifyType was introduced need an
-- explicit database-backed template key. Type 18 is the catalog's technical
-- evaluation timeout notification used for generic SLA timeout alerts.
UPDATE orbit_workflow.workflow_step_assignment a
   SET "notifyType" = 18,
       updated_at = CURRENT_TIMESTAMP
  FROM orbit_workflow.workflow_record r
 WHERE a.workflow_record_id = r.id
   AND a.sla IS NOT NULL
   AND a."notifyType" IS NULL;
