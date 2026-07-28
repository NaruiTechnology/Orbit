-- Sales entities imported from 销售-导入表初版-可编辑版.xlsx.
-- Included: 客户档案, 开票信息, 报价单, 合同管理, 下单界面, 芯片留存,
-- Bill (the first 对账 table only), 回款, 外包服务.
-- Excluded: 报价单「其他项目」area and the 对账 export-template area.

CREATE TABLE IF NOT EXISTS orbit_sales.customer_profile (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    short_name varchar(20) NOT NULL,
    customer_code varchar(24) NOT NULL UNIQUE,
    website varchar(255),
    primary_contact_name varchar(40) NOT NULL,
    landline varchar(20),
    primary_mobile varchar(20) NOT NULL,
    primary_email varchar(320),
    chip_application_category varchar(120) NOT NULL,
    source varchar(40) NOT NULL,
    stage varchar(40) NOT NULL,
    status varchar(20) NOT NULL,
    lock_status varchar(20) NOT NULL DEFAULT '未锁定',
    level varchar(10) NOT NULL DEFAULT '二级',
    competitors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(competitors) = 'array'),
    investor varchar(100),
    core_team_background varchar(100),
    laboratory_id uuid NOT NULL REFERENCES orbit_identity.laboratory(id) ON DELETE RESTRICT,
    sales_owner_id uuid NOT NULL REFERENCES orbit_identity.app_user(id) ON DELETE RESTRICT,
    public_pool_countdown_days integer,
    organization_id uuid REFERENCES orbit_identity.organization(id) ON DELETE RESTRICT,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN ('未成交', '已成交')),
    CHECK (lock_status IN ('未锁定', '已锁定')),
    CHECK (level IN ('一级', '二级', '三级'))
);

-- Stable catalog used by the Business Entities AG Grid. The table_name is
-- intentionally constrained to the nine generated business tables so the API
-- can safely build identifier-qualified queries for dynamic columns.
CREATE TABLE IF NOT EXISTS orbit_sales.business_entity_catalog (
    entity_key varchar(80) PRIMARY KEY,
    table_name varchar(80) NOT NULL UNIQUE,
    name_i18n jsonb NOT NULL CHECK (jsonb_typeof(name_i18n) = 'object'),
    display_order integer NOT NULL UNIQUE,
    is_active boolean NOT NULL DEFAULT true
);

INSERT INTO orbit_sales.business_entity_catalog (entity_key, table_name, name_i18n, display_order)
VALUES
    ('customer-profile', 'customer_profile', '{"en":"Customer Profile","zh_CN":"客户档案","zh_HK":"客戶檔案"}', 1),
    ('billing-information', 'billing_information', '{"en":"Billing Information","zh_CN":"开票信息","zh_HK":"開票資訊"}', 2),
    ('quotation', 'quotation', '{"en":"Quotation","zh_CN":"报价单","zh_HK":"報價單"}', 3),
    ('contract', 'contract', '{"en":"Contract","zh_CN":"合同管理","zh_HK":"合約管理"}', 4),
    ('sales-order', 'sales_order', '{"en":"Sales Order","zh_CN":"下单界面","zh_HK":"落單介面"}', 5),
    ('chip-retention', 'chip_retention', '{"en":"Chip Retention","zh_CN":"芯片留存","zh_HK":"晶片留存"}', 6),
    ('bill', 'bill', '{"en":"Bill","zh_CN":"账单","zh_HK":"帳單"}', 7),
    ('payment-collection', 'payment_collection', '{"en":"Payment Collection","zh_CN":"回款","zh_HK":"回款"}', 8),
    ('outsourced-service', 'outsourced_service', '{"en":"Outsourced Service","zh_CN":"外包服务","zh_HK":"外包服務"}', 9)
ON CONFLICT (entity_key) DO UPDATE
SET table_name = EXCLUDED.table_name,
    name_i18n = EXCLUDED.name_i18n,
    display_order = EXCLUDED.display_order,
    is_active = true;

CREATE TABLE IF NOT EXISTS orbit_sales.customer_contact (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES orbit_sales.customer_profile(id) ON DELETE CASCADE,
    name varchar(40) NOT NULL,
    department varchar(80),
    title varchar(80),
    is_key_decision_maker boolean NOT NULL DEFAULT false,
    phone varchar(20) NOT NULL,
    email varchar(320),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orbit_sales.billing_information (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL UNIQUE REFERENCES orbit_sales.customer_profile(id) ON DELETE CASCADE,
    invoice_title varchar(50) NOT NULL,
    tax_number varchar(20) NOT NULL,
    business_license_attachment_id uuid NOT NULL,
    address varchar(100) NOT NULL,
    invoice_laboratory varchar(40) NOT NULL,
    invoice_type varchar(40) NOT NULL,
    tax_rate numeric(5,2) NOT NULL,
    invoice_item varchar(120) NOT NULL,
    settlement_method varchar(20) NOT NULL,
    invoice_format varchar(10) NOT NULL DEFAULT 'PDF',
    finance_contact varchar(40) NOT NULL,
    finance_phone varchar(20) NOT NULL,
    reconciliation_email varchar(320) NOT NULL,
    organization_id uuid REFERENCES orbit_identity.organization(id) ON DELETE RESTRICT,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE RESTRICT,
    laboratory_id uuid REFERENCES orbit_identity.laboratory(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orbit_sales.quotation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quotation_number varchar(40) NOT NULL UNIQUE,
    customer_id uuid REFERENCES orbit_sales.customer_profile(id) ON DELETE SET NULL,
    valid_until date NOT NULL,
    decap_count integer CHECK (decap_count IS NULL OR decap_count >= 0),
    fib_hours numeric(12,2) NOT NULL DEFAULT 0 CHECK (fib_hours >= 0),
    fib_normal_glue_hours numeric(12,2) NOT NULL DEFAULT 0 CHECK (fib_normal_glue_hours >= 0),
    fib_high_temperature_glue_hours numeric(12,2) NOT NULL DEFAULT 0 CHECK (fib_high_temperature_glue_hours >= 0),
    manual_wire_pick_hours numeric(12,2) NOT NULL DEFAULT 0 CHECK (manual_wire_pick_hours >= 0),
    equipment_wire_cut_hours numeric(12,2) NOT NULL DEFAULT 0 CHECK (equipment_wire_cut_hours >= 0),
    equipment_pi_removal_hours numeric(12,2) NOT NULL DEFAULT 0 CHECK (equipment_pi_removal_hours >= 0),
    solder_ball_removal_count integer NOT NULL DEFAULT 0 CHECK (solder_ball_removal_count >= 0),
    copper_pillar_removal_count integer NOT NULL DEFAULT 0 CHECK (copper_pillar_removal_count >= 0),
    ball_planting_count integer NOT NULL DEFAULT 0 CHECK (ball_planting_count >= 0),
    pcb_mounting_fee_count integer NOT NULL DEFAULT 0 CHECK (pcb_mounting_fee_count >= 0),
    chemical_pi_removal_count integer NOT NULL DEFAULT 0 CHECK (chemical_pi_removal_count >= 0),
    au_bond_wire_count integer NOT NULL DEFAULT 0 CHECK (au_bond_wire_count >= 0),
    cu_bond_wire_count integer NOT NULL DEFAULT 0 CHECK (cu_bond_wire_count >= 0),
    alloy_al_special_bond_wire_count integer NOT NULL DEFAULT 0 CHECK (alloy_al_special_bond_wire_count >= 0),
    om_photo_count integer NOT NULL DEFAULT 0 CHECK (om_photo_count >= 0),
    cross_section_analysis_count integer NOT NULL DEFAULT 0 CHECK (cross_section_analysis_count >= 0),
    has_discount boolean NOT NULL DEFAULT false,
    discount_details text NOT NULL DEFAULT '',
    outsourced_project_count integer NOT NULL DEFAULT 0 CHECK (outsourced_project_count >= 0),
    organization_id uuid REFERENCES orbit_identity.organization(id) ON DELETE RESTRICT,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE RESTRICT,
    laboratory_id uuid REFERENCES orbit_identity.laboratory(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orbit_sales.contract (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(50) NOT NULL,
    contract_number varchar(40) NOT NULL UNIQUE,
    amount numeric(14,2) NOT NULL CHECK (amount > 0),
    signed_on date NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL CHECK (ends_on >= starts_on),
    signing_company varchar(50) NOT NULL,
    review_status varchar(20) NOT NULL DEFAULT '待审核',
    signing_contact varchar(40) NOT NULL,
    owner varchar(40) NOT NULL,
    notes varchar(300),
    attachment_id uuid NOT NULL,
    contract_type varchar(20) NOT NULL,
    fulfillment_status varchar(20) NOT NULL DEFAULT '执行中',
    customer_id uuid REFERENCES orbit_sales.customer_profile(id) ON DELETE SET NULL,
    organization_id uuid REFERENCES orbit_identity.organization(id) ON DELETE RESTRICT,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE RESTRICT,
    laboratory_id uuid REFERENCES orbit_identity.laboratory(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (review_status IN ('待审核', '已审核')),
    CHECK (fulfillment_status IN ('执行中', '已完结', '终止'))
);

CREATE TABLE IF NOT EXISTS orbit_sales.sales_order (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number varchar(80) NOT NULL UNIQUE,
    customer_id uuid NOT NULL REFERENCES orbit_sales.customer_profile(id) ON DELETE RESTRICT,
    project_engineer_id uuid REFERENCES orbit_identity.app_user(id) ON DELETE SET NULL,
    chip_model varchar(160) NOT NULL,
    chip_number varchar(120),
    outsourced_order_number varchar(120),
    project_name varchar(160) NOT NULL,
    evaluation_time timestamptz,
    yield_rate numeric(6,3) CHECK (yield_rate IS NULL OR (yield_rate >= 0 AND yield_rate <= 1)),
    decap_quantity integer NOT NULL CHECK (decap_quantity > 0),
    has_polyimide boolean NOT NULL,
    pi_removal_method varchar(20),
    package_type varchar(40) NOT NULL,
    packaged_chip_count integer NOT NULL CHECK (packaged_chip_count > 0),
    bond_wire_material varchar(80) NOT NULL,
    wire_separation_method varchar(20) NOT NULL,
    process_node varchar(40) NOT NULL,
    line_width varchar(40) NOT NULL,
    metal_layer_count integer NOT NULL CHECK (metal_layer_count > 0),
    fib_modification_area varchar(80) NOT NULL,
    design_chip_scaling varchar(40) NOT NULL,
    has_dummy boolean NOT NULL,
    wire_resistance_requirement varchar(80) NOT NULL,
    sensitive_device_below_area varchar(80) NOT NULL,
    dispensing_type varchar(20) NOT NULL,
    dispensing_count integer NOT NULL DEFAULT 0 CHECK (dispensing_count >= 0),
    pcb_count integer NOT NULL DEFAULT 0 CHECK (pcb_count >= 0),
    copper_pillar_removal_count integer NOT NULL DEFAULT 0 CHECK (copper_pillar_removal_count >= 0),
    solder_ball_removal_count integer NOT NULL DEFAULT 0 CHECK (solder_ball_removal_count >= 0),
    ball_planting_count integer NOT NULL DEFAULT 0 CHECK (ball_planting_count >= 0),
    special_requirements text,
    importance varchar(10) NOT NULL DEFAULT '一般',
    fib_failure_count integer NOT NULL DEFAULT 0 CHECK (fib_failure_count >= 0),
    failure_numbers varchar(500),
    test_result text,
    customer_returns_failure_sample boolean NOT NULL,
    organization_id uuid REFERENCES orbit_identity.organization(id) ON DELETE RESTRICT,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE RESTRICT,
    laboratory_id uuid REFERENCES orbit_identity.laboratory(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orbit_sales.chip_retention (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES orbit_sales.customer_profile(id) ON DELETE RESTRICT,
    order_id uuid NOT NULL REFERENCES orbit_sales.sales_order(id) ON DELETE RESTRICT,
    chip_model varchar(160) NOT NULL,
    received_on date NOT NULL,
    received_total integer NOT NULL CHECK (received_total > 0),
    used_this_time integer NOT NULL DEFAULT 0 CHECK (used_this_time >= 0),
    remaining_quantity integer GENERATED ALWAYS AS (received_total - used_this_time) STORED,
    storage_location varchar(50) NOT NULL,
    last_updated_on date NOT NULL DEFAULT CURRENT_DATE,
    organization_id uuid REFERENCES orbit_identity.organization(id) ON DELETE RESTRICT,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE RESTRICT,
    laboratory_id uuid REFERENCES orbit_identity.laboratory(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (used_this_time <= received_total)
);

CREATE TABLE IF NOT EXISTS orbit_sales.bill (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_number varchar(40) NOT NULL UNIQUE,
    customer_id uuid NOT NULL REFERENCES orbit_sales.customer_profile(id) ON DELETE RESTRICT,
    settlement_cycle varchar(20) NOT NULL,
    amount numeric(14,2) NOT NULL CHECK (amount >= 0),
    fee_number varchar(40) NOT NULL,
    billed_on date NOT NULL,
    project_name varchar(160) NOT NULL,
    unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
    time_or_quantity numeric(14,3) NOT NULL CHECK (time_or_quantity >= 0),
    subtotal numeric(14,2) GENERATED ALWAYS AS (round(unit_price * time_or_quantity, 2)) STORED,
    received_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
    project_engineer_id uuid REFERENCES orbit_identity.app_user(id) ON DELETE SET NULL,
    process_node varchar(40),
    product_plan_name varchar(160),
    notes varchar(100),
    send_status varchar(20) NOT NULL DEFAULT '未发送',
    reconciled_on date NOT NULL,
    organization_id uuid REFERENCES orbit_identity.organization(id) ON DELETE RESTRICT,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE RESTRICT,
    laboratory_id uuid REFERENCES orbit_identity.laboratory(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (send_status IN ('未发送', '已发送', '已确认'))
);

CREATE TABLE IF NOT EXISTS orbit_sales.payment_collection (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id uuid NOT NULL REFERENCES orbit_sales.bill(id) ON DELETE RESTRICT,
    customer_id uuid NOT NULL REFERENCES orbit_sales.customer_profile(id) ON DELETE RESTRICT,
    reconciled_on date NOT NULL,
    bill_amount numeric(14,2) NOT NULL CHECK (bill_amount >= 0),
    invoiced_on date,
    invoice_title varchar(50) NOT NULL,
    amount numeric(14,2) NOT NULL CHECK (amount > 0),
    paid_on date NOT NULL,
    bank varchar(80) NOT NULL,
    method varchar(20) NOT NULL,
    sales_owner_id uuid NOT NULL REFERENCES orbit_identity.app_user(id) ON DELETE RESTRICT,
    notes varchar(200),
    overdue_status varchar(10) NOT NULL DEFAULT '正常',
    overdue_days integer NOT NULL DEFAULT 0 CHECK (overdue_days >= 0),
    organization_id uuid REFERENCES orbit_identity.organization(id) ON DELETE RESTRICT,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE RESTRICT,
    laboratory_id uuid REFERENCES orbit_identity.laboratory(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orbit_sales.outsourced_service (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    processing_number varchar(40) NOT NULL UNIQUE,
    processed_on date NOT NULL,
    customer_id uuid NOT NULL REFERENCES orbit_sales.customer_profile(id) ON DELETE RESTRICT,
    project_engineer_id uuid REFERENCES orbit_identity.app_user(id) ON DELETE SET NULL,
    assigner varchar(40),
    project_name varchar(160) NOT NULL,
    amount_including_tax numeric(14,2) NOT NULL CHECK (amount_including_tax > 0),
    vendor varchar(50) NOT NULL,
    commissioning_number varchar(20),
    organization_id uuid REFERENCES orbit_identity.organization(id) ON DELETE RESTRICT,
    department_id uuid REFERENCES orbit_identity.department(id) ON DELETE RESTRICT,
    laboratory_id uuid REFERENCES orbit_identity.laboratory(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_customer_profile_owner ON orbit_sales.customer_profile (sales_owner_id, status);
CREATE INDEX IF NOT EXISTS ix_customer_contact_customer ON orbit_sales.customer_contact (customer_id);
CREATE INDEX IF NOT EXISTS ix_sales_order_customer ON orbit_sales.sales_order (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_chip_retention_order ON orbit_sales.chip_retention (order_id, received_on DESC);
CREATE INDEX IF NOT EXISTS ix_bill_customer_date ON orbit_sales.bill (customer_id, reconciled_on DESC);
CREATE INDEX IF NOT EXISTS ix_payment_collection_bill ON orbit_sales.payment_collection (bill_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS ix_outsourced_service_customer ON orbit_sales.outsourced_service (customer_id, processed_on DESC);

DROP TRIGGER IF EXISTS trg_sales_customer_profile_touch ON orbit_sales.customer_profile;
CREATE TRIGGER trg_sales_customer_profile_touch BEFORE UPDATE ON orbit_sales.customer_profile
FOR EACH ROW EXECUTE FUNCTION orbit_workflow.touch_versioned_row();
DROP TRIGGER IF EXISTS trg_sales_billing_information_touch ON orbit_sales.billing_information;
CREATE TRIGGER trg_sales_billing_information_touch BEFORE UPDATE ON orbit_sales.billing_information
FOR EACH ROW EXECUTE FUNCTION orbit_workflow.touch_versioned_row();
DROP TRIGGER IF EXISTS trg_sales_quotation_touch ON orbit_sales.quotation;
CREATE TRIGGER trg_sales_quotation_touch BEFORE UPDATE ON orbit_sales.quotation
FOR EACH ROW EXECUTE FUNCTION orbit_workflow.touch_versioned_row();
DROP TRIGGER IF EXISTS trg_sales_contract_touch ON orbit_sales.contract;
CREATE TRIGGER trg_sales_contract_touch BEFORE UPDATE ON orbit_sales.contract
FOR EACH ROW EXECUTE FUNCTION orbit_workflow.touch_versioned_row();
DROP TRIGGER IF EXISTS trg_sales_order_touch ON orbit_sales.sales_order;
CREATE TRIGGER trg_sales_order_touch BEFORE UPDATE ON orbit_sales.sales_order
FOR EACH ROW EXECUTE FUNCTION orbit_workflow.touch_versioned_row();
DROP TRIGGER IF EXISTS trg_sales_chip_retention_touch ON orbit_sales.chip_retention;
CREATE TRIGGER trg_sales_chip_retention_touch BEFORE UPDATE ON orbit_sales.chip_retention
FOR EACH ROW EXECUTE FUNCTION orbit_workflow.touch_versioned_row();
DROP TRIGGER IF EXISTS trg_sales_bill_touch ON orbit_sales.bill;
CREATE TRIGGER trg_sales_bill_touch BEFORE UPDATE ON orbit_sales.bill
FOR EACH ROW EXECUTE FUNCTION orbit_workflow.touch_versioned_row();
DROP TRIGGER IF EXISTS trg_sales_payment_collection_touch ON orbit_sales.payment_collection;
CREATE TRIGGER trg_sales_payment_collection_touch BEFORE UPDATE ON orbit_sales.payment_collection
FOR EACH ROW EXECUTE FUNCTION orbit_workflow.touch_versioned_row();
DROP TRIGGER IF EXISTS trg_sales_outsourced_service_touch ON orbit_sales.outsourced_service;
CREATE TRIGGER trg_sales_outsourced_service_touch BEFORE UPDATE ON orbit_sales.outsourced_service
FOR EACH ROW EXECUTE FUNCTION orbit_workflow.touch_versioned_row();
