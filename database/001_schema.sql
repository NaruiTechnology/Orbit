CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS orbit_identity;
CREATE SCHEMA IF NOT EXISTS orbit_workflow;
CREATE SCHEMA IF NOT EXISTS orbit_runtime;
CREATE SCHEMA IF NOT EXISTS orbit_audit;
CREATE SCHEMA IF NOT EXISTS orbit_sales;

DO $block$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_collation
        WHERE collname = 'en_sort' AND collnamespace = 'orbit_workflow'::regnamespace
    ) THEN
        BEGIN
            CREATE COLLATION orbit_workflow.en_sort (
                provider = icu,
                locale = 'en-u-ks-level2',
                deterministic = false
            );
        EXCEPTION WHEN feature_not_supported OR invalid_parameter_value THEN
            CREATE COLLATION orbit_workflow.en_sort FROM pg_catalog."C";
        END;
    END IF;
END
$block$;

DO $block$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_collation
        WHERE collname = 'zh_cn_sort' AND collnamespace = 'orbit_workflow'::regnamespace
    ) THEN
        BEGIN
            CREATE COLLATION orbit_workflow.zh_cn_sort (
                provider = icu,
                locale = 'zh-Hans-u-ks-level2',
                deterministic = false
            );
        EXCEPTION WHEN feature_not_supported OR invalid_parameter_value THEN
            CREATE COLLATION orbit_workflow.zh_cn_sort FROM pg_catalog."C";
        END;
    END IF;
END
$block$;

DO $block$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_collation
        WHERE collname = 'zh_hk_sort' AND collnamespace = 'orbit_workflow'::regnamespace
    ) THEN
        BEGIN
            CREATE COLLATION orbit_workflow.zh_hk_sort (
                provider = icu,
                locale = 'zh-Hant-HK-u-ks-level2',
                deterministic = false
            );
        EXCEPTION WHEN feature_not_supported OR invalid_parameter_value THEN
            CREATE COLLATION orbit_workflow.zh_hk_sort FROM pg_catalog."C";
        END;
    END IF;
END
$block$;

CREATE TABLE IF NOT EXISTS orbit_identity.organization (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(40) NOT NULL UNIQUE,
    name_i18n jsonb NOT NULL CHECK (jsonb_typeof(name_i18n) = 'object'),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orbit_identity.department (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES orbit_identity.organization(id) ON DELETE CASCADE,
    code varchar(40) NOT NULL,
    name_i18n jsonb NOT NULL CHECK (jsonb_typeof(name_i18n) = 'object'),
    is_active boolean NOT NULL DEFAULT true,
    UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS orbit_identity.laboratory (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES orbit_identity.organization(id) ON DELETE CASCADE,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE SET NULL,
    code varchar(40) NOT NULL,
    name_i18n jsonb NOT NULL CHECK (jsonb_typeof(name_i18n) = 'object'),
    timezone varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
    is_active boolean NOT NULL DEFAULT true,
    UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS orbit_identity.app_user (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    login_name varchar(120) NOT NULL,
    display_name_i18n jsonb NOT NULL CHECK (jsonb_typeof(display_name_i18n) = 'object'),
    email varchar(320),
    is_active boolean NOT NULL DEFAULT true,
    preferred_locale varchar(10) NOT NULL DEFAULT 'zh-CN',
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (login_name)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_app_user_login_lower
    ON orbit_identity.app_user (lower(login_name));

CREATE TABLE IF NOT EXISTS orbit_identity.user_membership (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES orbit_identity.app_user(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES orbit_identity.organization(id) ON DELETE CASCADE,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE CASCADE,
    laboratory_id uuid REFERENCES orbit_identity.laboratory(id) ON DELETE CASCADE,
    is_primary boolean NOT NULL DEFAULT false,
    UNIQUE (user_id, organization_id, department_id, laboratory_id)
);

CREATE TABLE IF NOT EXISTS orbit_identity.role (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(60) NOT NULL UNIQUE,
    name_i18n jsonb NOT NULL CHECK (jsonb_typeof(name_i18n) = 'object'),
    is_system boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS orbit_identity.permission (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(100) NOT NULL UNIQUE,
    description varchar(500) NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS orbit_identity.role_permission (
    role_id uuid NOT NULL REFERENCES orbit_identity.role(id) ON DELETE CASCADE,
    permission_id uuid NOT NULL REFERENCES orbit_identity.permission(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS orbit_identity.user_role (
    user_id uuid NOT NULL REFERENCES orbit_identity.app_user(id) ON DELETE CASCADE,
    role_id uuid NOT NULL REFERENCES orbit_identity.role(id) ON DELETE CASCADE,
    organization_id uuid REFERENCES orbit_identity.organization(id) ON DELETE CASCADE,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE CASCADE,
    laboratory_id uuid REFERENCES orbit_identity.laboratory(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS orbit_identity.role_workflow_access (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id uuid NOT NULL REFERENCES orbit_identity.role(id) ON DELETE CASCADE,
    scope_type varchar(20) NOT NULL CHECK (scope_type IN ('global', 'group', 'workflow')),
    scope_key varchar(100) NOT NULL,
    can_view boolean NOT NULL DEFAULT true,
    can_edit boolean NOT NULL DEFAULT false,
    can_execute boolean NOT NULL DEFAULT false,
    UNIQUE (role_id, scope_type, scope_key)
);

CREATE TABLE IF NOT EXISTS orbit_workflow.workflow_definition (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_key varchar(100) NOT NULL UNIQUE,
    parent_id uuid REFERENCES orbit_workflow.workflow_definition(id) ON DELETE SET NULL,
    group_key varchar(40) NOT NULL,
    definition_type varchar(40) NOT NULL,
    name_i18n jsonb NOT NULL CHECK (jsonb_typeof(name_i18n) = 'object'),
    group_name_i18n jsonb NOT NULL CHECK (jsonb_typeof(group_name_i18n) = 'object'),
    source_sheet varchar(200) NOT NULL,
    source_sheet_index integer NOT NULL,
    source_sha256 char(64) NOT NULL,
    is_master boolean NOT NULL DEFAULT false,
    display_order integer NOT NULL,
    schema_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(schema_json) = 'array'),
    edges_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(edges_json) = 'array'),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    catalog_version integer NOT NULL DEFAULT 1,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_workflow_definition_navigation
    ON orbit_workflow.workflow_definition (group_key, display_order)
    WHERE is_active;

CREATE TABLE IF NOT EXISTS orbit_workflow.workflow_record (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id uuid NOT NULL REFERENCES orbit_workflow.workflow_definition(id) ON DELETE CASCADE,
    record_key varchar(140) NOT NULL,
    record_order integer NOT NULL,
    label_i18n jsonb NOT NULL CHECK (jsonb_typeof(label_i18n) = 'object'),
    values_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(values_json) = 'object'),
    source_row integer,
    source_cells jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_cells) = 'object'),
    organization_id uuid REFERENCES orbit_identity.organization(id) ON DELETE RESTRICT,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE RESTRICT,
    laboratory_id uuid REFERENCES orbit_identity.laboratory(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workflow_id, record_key),
    UNIQUE (workflow_id, record_order)
);

CREATE INDEX IF NOT EXISTS ix_workflow_record_order
    ON orbit_workflow.workflow_record (workflow_id, record_order);
CREATE INDEX IF NOT EXISTS ix_workflow_record_values_gin
    ON orbit_workflow.workflow_record USING gin (values_json);
CREATE INDEX IF NOT EXISTS ix_workflow_record_scope
    ON orbit_workflow.workflow_record (organization_id, department_id, laboratory_id);

-- Runtime/business data shown in DataGrids.  This table is deliberately
-- separate from workflow_record: the latter is the process graph source used
-- by the tree panel, while this table is the editable business data source.
CREATE TABLE IF NOT EXISTS orbit_workflow.workflow_business_record (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id uuid NOT NULL REFERENCES orbit_workflow.workflow_definition(id) ON DELETE CASCADE,
    workflow_record_id uuid REFERENCES orbit_workflow.workflow_record(id) ON DELETE SET NULL,
    record_key varchar(140) NOT NULL,
    record_order integer NOT NULL,
    label_i18n jsonb NOT NULL CHECK (jsonb_typeof(label_i18n) = 'object'),
    values_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(values_json) = 'object'),
    source_row integer,
    source_cells jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_cells) = 'object'),
    organization_id uuid REFERENCES orbit_identity.organization(id) ON DELETE RESTRICT,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE RESTRICT,
    laboratory_id uuid REFERENCES orbit_identity.laboratory(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workflow_id, record_key),
    UNIQUE (workflow_id, record_order)
);

CREATE INDEX IF NOT EXISTS ix_workflow_business_record_order
    ON orbit_workflow.workflow_business_record (workflow_id, record_order);
CREATE INDEX IF NOT EXISTS ix_workflow_business_record_values_gin
    ON orbit_workflow.workflow_business_record USING gin (values_json);
CREATE INDEX IF NOT EXISTS ix_workflow_business_record_scope
    ON orbit_workflow.workflow_business_record (organization_id, department_id, laboratory_id);

-- Customer orders are business entities, not workflow steps.  The Order
-- Evaluation grid is backed by this table; the workflow_record table remains
-- the process-definition source for the right-hand workflow tree.
CREATE TABLE IF NOT EXISTS orbit_sales.customer_order (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number varchar(80) NOT NULL UNIQUE,
    customer_code varchar(80),
    customer_name varchar(200) NOT NULL,
    customer_contact varchar(200),
    chip_name varchar(200) NOT NULL,
    chip_model varchar(160),
    package_type varchar(120),
    quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
    source_laboratory varchar(160),
    target_laboratory varchar(160),
    requested_due_date date,
    priority varchar(24) NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status varchar(32) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'under_evaluation', 'approved', 'rejected', 'cancelled')),
    evaluation_result text,
    notes text,
    organization_id uuid REFERENCES orbit_identity.organization(id) ON DELETE RESTRICT,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE RESTRICT,
    laboratory_id uuid REFERENCES orbit_identity.laboratory(id) ON DELETE RESTRICT,
    created_by uuid NOT NULL REFERENCES orbit_identity.app_user(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_customer_order_scope_status
    ON orbit_sales.customer_order (organization_id, department_id, laboratory_id, status);
CREATE INDEX IF NOT EXISTS ix_customer_order_customer
    ON orbit_sales.customer_order (customer_code, customer_name);

CREATE TABLE IF NOT EXISTS orbit_runtime.workflow_instance (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id uuid NOT NULL REFERENCES orbit_workflow.workflow_definition(id) ON DELETE RESTRICT,
    business_key varchar(160) NOT NULL,
    current_record_key varchar(140),
    status varchar(24) NOT NULL DEFAULT 'active'
        CHECK (status IN ('draft', 'active', 'waiting', 'completed', 'cancelled', 'failed')),
    context_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context_json) = 'object'),
    organization_id uuid NOT NULL REFERENCES orbit_identity.organization(id) ON DELETE RESTRICT,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE RESTRICT,
    laboratory_id uuid REFERENCES orbit_identity.laboratory(id) ON DELETE RESTRICT,
    started_by uuid NOT NULL REFERENCES orbit_identity.app_user(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1,
    started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workflow_id, business_key)
);

CREATE INDEX IF NOT EXISTS ix_workflow_instance_scope_status
    ON orbit_runtime.workflow_instance (organization_id, department_id, laboratory_id, status);

CREATE TABLE IF NOT EXISTS orbit_runtime.workflow_task (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id uuid NOT NULL REFERENCES orbit_runtime.workflow_instance(id) ON DELETE CASCADE,
    record_key varchar(140) NOT NULL,
    assigned_role_id uuid REFERENCES orbit_identity.role(id) ON DELETE SET NULL,
    assigned_user_id uuid REFERENCES orbit_identity.app_user(id) ON DELETE SET NULL,
    state varchar(24) NOT NULL DEFAULT 'open'
        CHECK (state IN ('open', 'claimed', 'completed', 'cancelled')),
    due_at timestamptz,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_workflow_task_assignee_state
    ON orbit_runtime.workflow_task (assigned_user_id, state, due_at);

CREATE TABLE IF NOT EXISTS orbit_runtime.transition_event (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    instance_id uuid NOT NULL REFERENCES orbit_runtime.workflow_instance(id) ON DELETE CASCADE,
    from_record_key varchar(140),
    to_record_key varchar(140),
    outcome varchar(40) NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
    actor_user_id uuid NOT NULL REFERENCES orbit_identity.app_user(id) ON DELETE RESTRICT,
    occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_transition_event_instance_time
    ON orbit_runtime.transition_event (instance_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS orbit_audit.audit_event (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id uuid REFERENCES orbit_identity.app_user(id) ON DELETE SET NULL,
    action varchar(100) NOT NULL,
    entity_type varchar(100) NOT NULL,
    entity_id varchar(160),
    organization_id uuid REFERENCES orbit_identity.organization(id) ON DELETE SET NULL,
    before_json jsonb,
    after_json jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_audit_event_entity_time
    ON orbit_audit.audit_event (entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_event_actor_time
    ON orbit_audit.audit_event (actor_user_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION orbit_workflow.touch_versioned_row()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    NEW.version = OLD.version + 1;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_workflow_record_touch ON orbit_workflow.workflow_record;
CREATE TRIGGER trg_workflow_record_touch
BEFORE UPDATE ON orbit_workflow.workflow_record
FOR EACH ROW EXECUTE FUNCTION orbit_workflow.touch_versioned_row();

DROP TRIGGER IF EXISTS trg_workflow_business_record_touch ON orbit_workflow.workflow_business_record;
CREATE TRIGGER trg_workflow_business_record_touch
BEFORE UPDATE ON orbit_workflow.workflow_business_record
FOR EACH ROW EXECUTE FUNCTION orbit_workflow.touch_versioned_row();

DROP TRIGGER IF EXISTS trg_customer_order_touch ON orbit_sales.customer_order;
CREATE TRIGGER trg_customer_order_touch
BEFORE UPDATE ON orbit_sales.customer_order
FOR EACH ROW EXECUTE FUNCTION orbit_workflow.touch_versioned_row();

DROP TRIGGER IF EXISTS trg_workflow_instance_touch ON orbit_runtime.workflow_instance;
CREATE TRIGGER trg_workflow_instance_touch
BEFORE UPDATE ON orbit_runtime.workflow_instance
FOR EACH ROW EXECUTE FUNCTION orbit_workflow.touch_versioned_row();

COMMENT ON COLUMN orbit_workflow.workflow_definition.name_i18n IS
    'Localized master data keyed by en, zh_CN, and zh_HK.';
COMMENT ON COLUMN orbit_workflow.workflow_record.values_json IS
    'Workflow graph-node metadata; not the DataGrid business data source.';
COMMENT ON COLUMN orbit_workflow.workflow_business_record.values_json IS
    'Editable mixed-language UTF-8 business values keyed by stable English identifiers.';
