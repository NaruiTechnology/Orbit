-- Automated SLA email rendering now resolves templates from
-- orbit_workflow.notify by notifyType. Remove the obsolete XML-template
-- function so it cannot be mistaken for the active mail path.
DROP FUNCTION IF EXISTS orbit_workflow.get_email_template(uuid);
