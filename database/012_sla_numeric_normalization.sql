-- Normalize all future and existing SLA checks from free-form configuration.
-- The runtime function is deliberately shared by the cron worker and API
-- callers, so values such as "5" and "5个工作日内" resolve to 5 days.

CREATE OR REPLACE FUNCTION orbit_workflow.extract_sla_days(p_text text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
    v_numeric text;
BEGIN
    v_numeric := regexp_replace(trim(coalesce(p_text, '')), '[^0-9.]', '', 'g');
    IF v_numeric IS NULL
       OR v_numeric = ''
       OR v_numeric !~ '^[0-9]+([.][0-9]+)?$'
       OR v_numeric::numeric < 1 THEN
        RETURN NULL;
    END IF;
    RETURN v_numeric::numeric;
END
$function$;

COMMENT ON FUNCTION orbit_workflow.extract_sla_days(text) IS
    'Extract numeric SLA days from free-form workflow-step configuration.';
