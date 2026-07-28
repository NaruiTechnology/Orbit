INSERT INTO orbit_identity.organization (id, code, name_i18n)
VALUES (
    '10000000-0000-0000-0000-000000000001',
    'IONBEAM',
    '{"en":"Ion Beam Technology","zh_CN":"离子束科技","zh_HK":"離子束科技"}'::jsonb
)
ON CONFLICT (code) DO UPDATE SET name_i18n = EXCLUDED.name_i18n;

INSERT INTO orbit_identity.department (id, organization_id, code, name_i18n)
VALUES
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'SALES', '{"en":"Sales","zh_CN":"销售部","zh_HK":"銷售部"}'),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'HR', '{"en":"Human Resources","zh_CN":"人力资源部","zh_HK":"人力資源部"}'),
    ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'TECH', '{"en":"Technical Operations","zh_CN":"技术部","zh_HK":"技術部"}'),
    ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'EQUIPMENT', '{"en":"Equipment","zh_CN":"设备部","zh_HK":"設備部"}'),
    ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'FINANCE', '{"en":"Finance","zh_CN":"财务部","zh_HK":"財務部"}')
ON CONFLICT (organization_id, code) DO UPDATE SET name_i18n = EXCLUDED.name_i18n;

INSERT INTO orbit_identity.laboratory (
    id, organization_id, department_id, code, name_i18n, timezone
)
SELECT
    ('30000000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid,
    '10000000-0000-0000-0000-000000000001'::uuid,
    '20000000-0000-0000-0000-000000000003'::uuid,
    'LAB-' || lpad(number::text, 2, '0'),
    jsonb_build_object(
        'en', (ARRAY['Beijing', 'Shanghai', 'Shenzheng', 'Wuxi', 'Xian', 'Chengdu', 'Hangzhou', 'Tianjing', 'Taixin'])[number],
        'zh_CN', (ARRAY['北京', '上海', '深圳', '无锡', '西安', '成都', '杭州', '天津', '泰兴'])[number],
        'zh_HK', (ARRAY['北京', '上海', '深圳', '無錫', '西安', '成都', '杭州', '天津', '泰興'])[number]
    ),
    'Asia/Shanghai'
FROM generate_series(1, 9) AS number
ON CONFLICT (organization_id, code) DO UPDATE
SET name_i18n = EXCLUDED.name_i18n, timezone = EXCLUDED.timezone;

INSERT INTO orbit_identity.role (id, code, name_i18n, is_system)
VALUES
    ('40000000-0000-0000-0000-000000000001', 'administrator', '{"en":"Administrator","zh_CN":"系统管理员","zh_HK":"系統管理員"}', true),
    ('40000000-0000-0000-0000-000000000002', 'manager', '{"en":"Manager","zh_CN":"经理","zh_HK":"經理"}', true),
    ('40000000-0000-0000-0000-000000000003', 'operator', '{"en":"Operator","zh_CN":"业务操作员","zh_HK":"業務操作員"}', true),
    ('40000000-0000-0000-0000-000000000004', 'viewer', '{"en":"Viewer","zh_CN":"只读用户","zh_HK":"唯讀使用者"}', true)
ON CONFLICT (code) DO UPDATE SET name_i18n = EXCLUDED.name_i18n;

INSERT INTO orbit_identity.permission (id, code, description)
VALUES
    ('50000000-0000-0000-0000-000000000001', 'workflow.read', 'Read workflow definitions and scoped records'),
    ('50000000-0000-0000-0000-000000000002', 'workflow.write', 'Edit scoped workflow records'),
    ('50000000-0000-0000-0000-000000000003', 'workflow.execute', 'Start and transition workflow instances'),
    ('50000000-0000-0000-0000-000000000004', 'administration.manage', 'Manage users, roles, and workflow configuration')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO orbit_identity.role_permission (role_id, permission_id)
SELECT role_id, permission_id
FROM (
    VALUES
        ('40000000-0000-0000-0000-000000000001'::uuid, '50000000-0000-0000-0000-000000000001'::uuid),
        ('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002'),
        ('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003'),
        ('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000004'),
        ('40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001'),
        ('40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002'),
        ('40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003'),
        ('40000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001'),
        ('40000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003'),
        ('40000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000001')
) AS grants(role_id, permission_id)
ON CONFLICT DO NOTHING;

INSERT INTO orbit_identity.role_workflow_access (
    role_id, scope_type, scope_key, can_view, can_edit, can_execute
)
VALUES
    ('40000000-0000-0000-0000-000000000001', 'global', '*', true, true, true),
    ('40000000-0000-0000-0000-000000000002', 'global', '*', true, true, true),
    ('40000000-0000-0000-0000-000000000003', 'group', 'sales', true, false, true),
    ('40000000-0000-0000-0000-000000000003', 'group', 'operations', true, false, true),
    ('40000000-0000-0000-0000-000000000004', 'global', '*', true, false, false)
ON CONFLICT (role_id, scope_type, scope_key) DO UPDATE
SET can_view = EXCLUDED.can_view,
    can_edit = EXCLUDED.can_edit,
    can_execute = EXCLUDED.can_execute;

INSERT INTO orbit_identity.app_user (
    id, login_name, display_name_i18n, first_name, last_name, email,
    phone_number, company_name, site, preferred_locale
)
VALUES (
    '60000000-0000-0000-0000-000000000001',
    'orbit.admin',
    '{"en":"Orbit Administrator","zh_CN":"Orbit 系统管理员","zh_HK":"Orbit 系統管理員"}',
    'Orbit',
    'Administrator',
    'orbit.admin@localhost',
    '15038079055',
    'Ionbeamtech',
    'Beijing(北京)',
    'zh-CN'
)
ON CONFLICT (login_name) DO UPDATE
SET display_name_i18n = EXCLUDED.display_name_i18n,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    phone_number = EXCLUDED.phone_number,
    company_name = EXCLUDED.company_name,
    site = EXCLUDED.site,
    preferred_locale = EXCLUDED.preferred_locale,
    is_active = true;

INSERT INTO orbit_identity.user_membership (
    user_id, organization_id, department_id, laboratory_id, is_primary
)
VALUES (
    '60000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000001',
    true
)
ON CONFLICT (user_id, organization_id, department_id, laboratory_id)
DO UPDATE SET is_primary = true;

INSERT INTO orbit_identity.user_role (
    user_id, role_id, organization_id, department_id, laboratory_id
)
VALUES (
    '60000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    NULL,
    NULL
)
ON CONFLICT (user_id, role_id) DO UPDATE
SET organization_id = EXCLUDED.organization_id,
    department_id = EXCLUDED.department_id,
    laboratory_id = EXCLUDED.laboratory_id;
