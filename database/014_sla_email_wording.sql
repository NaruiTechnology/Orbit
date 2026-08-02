-- Use clear SLA wording in existing seeded notification templates.
UPDATE orbit_workflow.notification_template
   SET body_xml = replace(
       body_xml,
       '{{step_name}} has an SLA event.',
       'The following {{sla_step_name}} passed the SLA due.'
   )
 WHERE body_xml LIKE '%{{step_name}} has an SLA event.%';

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
           coalesce(custom.body_xml, nt.body_xml, '<body><p>The following {{sla_step_name}} passed the SLA due.</p>{{items_table}}</body>'),
           coalesce(custom.stylesheet_css, nt.stylesheet_css, ''),
           coalesce(custom.access_url_template, nt.access_url_template, '')
      FROM (SELECT 1) seed
      LEFT JOIN orbit_workflow.workflow_email_template custom
        ON custom.workflow_record_id = p_workflow_step_id AND custom.is_active
      LEFT JOIN orbit_workflow.notification_template nt
        ON nt.workflow_record_id = p_workflow_step_id AND nt.is_active
$function$;
