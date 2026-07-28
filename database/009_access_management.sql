-- Access-management compatibility migration.
-- The former Orbit roles (administrator/manager/operator/viewer) are mapped to
-- the Iobeam canonical role set: Audit, Admin, SuperUser, and User.

-- Merge each legacy role into an existing canonical role. This handles both a
-- fresh install and a database that has already received part of the mapping.
DO $merge$
DECLARE
    mapping record;
    old_id uuid;
    target_id uuid;
BEGIN
    FOR mapping IN
        SELECT * FROM (VALUES
            ('administrator', 'admin'), ('manager', 'super_user'),
            ('operator', 'user'), ('viewer', 'user')
        ) AS mappings(old_code, new_code)
    LOOP
        SELECT id INTO old_id FROM orbit_identity.role WHERE code = mapping.old_code;
        SELECT id INTO target_id FROM orbit_identity.role WHERE code = mapping.new_code;
        IF old_id IS NOT NULL AND target_id IS NULL THEN
            UPDATE orbit_identity.role SET code = mapping.new_code WHERE id = old_id;
            target_id := old_id;
        ELSIF old_id IS NOT NULL AND target_id IS NOT NULL AND old_id <> target_id THEN
            INSERT INTO orbit_identity.user_role (user_id, role_id, organization_id, department_id, laboratory_id)
            SELECT old.user_id, target_id, old.organization_id, old.department_id, old.laboratory_id
              FROM orbit_identity.user_role old
             WHERE old.role_id = old_id
               AND NOT EXISTS (SELECT 1 FROM orbit_identity.user_role existing WHERE existing.user_id = old.user_id AND existing.role_id = target_id)
            ON CONFLICT DO NOTHING;
            DELETE FROM orbit_identity.user_role WHERE role_id = old_id;
            DELETE FROM orbit_identity.role_permission WHERE role_id = old_id;
            DELETE FROM orbit_identity.role_workflow_access WHERE role_id = old_id;
            DELETE FROM orbit_identity.role WHERE id = old_id;
        END IF;
    END LOOP;
END
$merge$;

UPDATE orbit_identity.role SET name_i18n = CASE code
    WHEN 'admin' THEN '{"en":"Admin","zh_CN":"管理员","zh_HK":"管理員"}'::jsonb
    WHEN 'super_user' THEN '{"en":"SuperUser","zh_CN":"超级用户","zh_HK":"超級使用者"}'::jsonb
    WHEN 'user' THEN '{"en":"User","zh_CN":"用户","zh_HK":"使用者"}'::jsonb
    WHEN 'audit' THEN '{"en":"Audit","zh_CN":"审计员","zh_HK":"稽核員"}'::jsonb
    ELSE name_i18n END
 WHERE code IN ('admin', 'super_user', 'user', 'audit');

INSERT INTO orbit_identity.role (code, name_i18n, is_system)
VALUES ('audit', '{"en":"Audit","zh_CN":"审计员","zh_HK":"稽核員"}'::jsonb, true)
ON CONFLICT (code) DO UPDATE SET name_i18n = EXCLUDED.name_i18n, is_system = true;

-- Keep the integer compatibility catalogue aligned with the four exposed roles.
UPDATE orbit_identity.role_definition
   SET role_name = CASE role_id
       WHEN 0 THEN 'USER' WHEN 1 THEN 'SUPER_USER' WHEN 3 THEN 'ADMIN' WHEN 4 THEN 'AUDIT'
       ELSE role_name END,
       display_name_i18n = CASE role_id
       WHEN 0 THEN '{"en":"User","zh_CN":"用户","zh_HK":"使用者"}'::jsonb
       WHEN 1 THEN '{"en":"SuperUser","zh_CN":"超级用户","zh_HK":"超級使用者"}'::jsonb
       WHEN 3 THEN '{"en":"Admin","zh_CN":"管理员","zh_HK":"管理員"}'::jsonb
       WHEN 4 THEN '{"en":"Audit","zh_CN":"审计员","zh_HK":"稽核員"}'::jsonb
       ELSE display_name_i18n END,
       is_active = role_id IN (0, 1, 3, 4);
DELETE FROM orbit_identity.role_definition WHERE role_id = 2;

-- Auditors are imported from IobeamAdmin/Sql/001_schema.sql.  source_id keeps
-- the migration traceable while Orbit uses UUIDs for identity tables.
CREATE TABLE IF NOT EXISTS orbit_audit.auditor (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id integer UNIQUE,
    user_name varchar(200) NOT NULL,
    email varchar(320) NOT NULL UNIQUE,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO orbit_audit.auditor (source_id, user_name, email, is_active)
VALUES
    (1, 'Henry Li', 'lyh1154@gmail.com', true),
    (2, 'Sen Da', 'xda@ionbeamtech.com', true),
    (3, 'Yuyao Jiang', 'yuyao.jiang@ionbeamtech.com', true)
ON CONFLICT (email) DO UPDATE
   SET source_id = EXCLUDED.source_id, user_name = EXCLUDED.user_name, is_active = EXCLUDED.is_active;

-- Repair accounts created before access-management started provisioning scope.
-- A verified account without a primary membership cannot call protected APIs.
INSERT INTO orbit_identity.user_membership (
    user_id, organization_id, department_id, laboratory_id, is_primary
)
SELECT u.id, o.id, l.department_id, l.id, true
  FROM orbit_identity.app_user u
 CROSS JOIN LATERAL (SELECT id FROM orbit_identity.organization ORDER BY code LIMIT 1) o
 CROSS JOIN LATERAL (SELECT id, department_id FROM orbit_identity.laboratory ORDER BY code LIMIT 1) l
 WHERE NOT EXISTS (
     SELECT 1 FROM orbit_identity.user_membership existing WHERE existing.user_id = u.id
 )
ON CONFLICT (user_id, organization_id, department_id, laboratory_id)
DO UPDATE SET is_primary = true;

-- Audit accounts can administer access-management data, matching the sibling
-- application’s Auditor privilege without granting workflow write access.
INSERT INTO orbit_identity.role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM orbit_identity.role r CROSS JOIN orbit_identity.permission p
 WHERE r.code = 'audit' AND p.code = 'administration.manage'
ON CONFLICT DO NOTHING;

INSERT INTO orbit_identity.role_workflow_access (role_id, scope_type, scope_key, can_view, can_edit, can_execute)
SELECT r.id, 'global', '*', true, false, false
  FROM orbit_identity.role r WHERE r.code = 'audit'
ON CONFLICT (role_id, scope_type, scope_key) DO UPDATE
 SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit, can_execute = EXCLUDED.can_execute;
