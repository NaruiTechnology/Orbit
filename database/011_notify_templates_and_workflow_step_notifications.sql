-- Notification templates from ManagementV2.xlsx / 通知模板配置.
-- Text columns use the same locale-object shape as the rest of Orbit's
-- configuration data. Column G (是否可自定义) is intentionally omitted.
CREATE TABLE IF NOT EXISTS orbit_workflow.notify (
    notify_type integer PRIMARY KEY CHECK (notify_type BETWEEN 1 AND 53),
    notification_scenario jsonb NOT NULL CHECK (jsonb_typeof(notification_scenario) = 'object'),
    notification_channel jsonb NOT NULL CHECK (jsonb_typeof(notification_channel) = 'object'),
    recipient jsonb NOT NULL CHECK (jsonb_typeof(recipient) = 'object'),
    template_title jsonb NOT NULL CHECK (jsonb_typeof(template_title) = 'object'),
    template_body jsonb NOT NULL CHECK (jsonb_typeof(template_body) = 'object'),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The workbook catalog is imported immediately before this migration during
-- bootstrap. Reusing that imported source keeps the database seed byte-for-
-- byte aligned with the workbook while preserving locale-aware JSON values.
DELETE FROM orbit_workflow.notify;

INSERT INTO orbit_workflow.notify (
    notify_type, notification_scenario, notification_channel, recipient,
    template_title, template_body
)
SELECT
    CASE WHEN r.record_order >= 12 THEN r.record_order + 1 ELSE r.record_order END,
    jsonb_build_object(
        'en', r.values_json ->> 'notification_scenario',
        'zh_CN', r.values_json ->> 'notification_scenario',
        'zh_HK', r.values_json ->> 'notification_scenario'
    ),
    jsonb_build_object(
        'en', CASE WHEN r.values_json ->> 'notification_channel' IN ('登录弹窗', '弹窗', '系统弹窗', '邮件') THEN 'mail' ELSE r.values_json ->> 'notification_channel' END,
        'zh_CN', CASE WHEN r.values_json ->> 'notification_channel' IN ('登录弹窗', '弹窗', '系统弹窗', '邮件') THEN '邮件' ELSE r.values_json ->> 'notification_channel' END,
        'zh_HK', CASE WHEN r.values_json ->> 'notification_channel' IN ('登录弹窗', '弹窗', '系统弹窗', '邮件') THEN '郵件' ELSE r.values_json ->> 'notification_channel' END
    ),
    jsonb_build_object(
        'en', r.values_json ->> 'recipient',
        'zh_CN', r.values_json ->> 'recipient',
        'zh_HK', r.values_json ->> 'recipient'
    ),
    jsonb_build_object(
        'en', r.values_json ->> 'template_title',
        'zh_CN', r.values_json ->> 'template_title',
        'zh_HK', r.values_json ->> 'template_title'
    ),
    jsonb_build_object(
        'en', r.values_json ->> 'template_body',
        'zh_CN', r.values_json ->> 'template_body',
        'zh_HK', r.values_json ->> 'template_body'
    )
FROM orbit_workflow.notification_template r
JOIN orbit_workflow.workflow_definition w ON w.id = r.definition_id
WHERE w.workflow_key = 'business-notification-templates'
  AND r.is_active
  AND r.record_order BETWEEN 1 AND 53
ON CONFLICT (notify_type) DO UPDATE SET
    notification_scenario = EXCLUDED.notification_scenario,
    notification_channel = EXCLUDED.notification_channel,
    recipient = EXCLUDED.recipient,
    template_title = EXCLUDED.template_title,
    template_body = EXCLUDED.template_body,
    updated_at = CURRENT_TIMESTAMP;

-- The checked-in catalog predates the workbook's row 12. Keep this source row
-- explicit until the catalog is regenerated, so the database still contains
-- all 53 workbook templates with the original numbering.
INSERT INTO orbit_workflow.notify (
    notify_type, notification_scenario, notification_channel, recipient,
    template_title, template_body
)
VALUES (
    12,
    '{"en":"公海预警通知","zh_CN":"公海预警通知","zh_HK":"公海預警通知"}'::jsonb,
    '{"en":"弹窗+企业微信+短信","zh_CN":"弹窗+企业微信+短信","zh_HK":"彈窗+企業微信+短信"}'::jsonb,
    '{"en":"销售本人","zh_CN":"销售本人","zh_HK":"銷售本人"}'::jsonb,
    '{"en":"客户即将进入公海","zh_CN":"客户即将进入公海","zh_HK":"客戶即將進入公海"}'::jsonb,
    '{"en":"“[客户名称]（[芯片分类]客户）将在3天后进入公海池，请尽快联系并更新跟进记录！若需保留客户，请在系统中提交‘保留申请’并说明原因（如‘客户正在走采购流程，预计下周签约’），审批通过后可暂不回收。","zh_CN":"“[客户名称]（[芯片分类]客户）将在3天后进入公海池，请尽快联系并更新跟进记录！若需保留客户，请在系统中提交‘保留申请’并说明原因（如‘客户正在走采购流程，预计下周签约’），审批通过后可暂不回收。","zh_HK":"“[客戶名稱]（[晶片分類]客戶）將在3天後進入公海池，請盡快聯繫並更新跟進記錄！若需保留客戶，請在系統中提交‘保留申請’並說明原因（如‘客戶正在走採購流程，預計下週簽約’），審批通過後可暫不回收。"}'::jsonb
)
ON CONFLICT (notify_type) DO UPDATE SET
    notification_scenario = EXCLUDED.notification_scenario,
    notification_channel = EXCLUDED.notification_channel,
    recipient = EXCLUDED.recipient,
    template_title = EXCLUDED.template_title,
    template_body = EXCLUDED.template_body,
    updated_at = CURRENT_TIMESTAMP;

-- Workflow-step notification state. Keep the camelCase API contract in the
-- database, matching DocumentAction and decisionAction in this table.
ALTER TABLE orbit_workflow.workflow_step_assignment
    ADD COLUMN IF NOT EXISTS "notifyAction" integer,
    ADD COLUMN IF NOT EXISTS "notifiedDate" timestamptz;

-- Keep the workflow step notification assignment as a single enum value.
-- Existing multi-select data is reduced to its first selected value.
ALTER TABLE orbit_workflow.workflow_step_assignment
    DROP CONSTRAINT IF EXISTS workflow_step_assignment_notify_action_check;

DO $block$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'orbit_workflow'
           AND table_name = 'workflow_step_assignment'
           AND column_name = 'notifyAction'
           AND data_type = 'ARRAY'
    ) THEN
        ALTER TABLE orbit_workflow.workflow_step_assignment
            ALTER COLUMN "notifyAction" TYPE integer
            USING "notifyAction"[1];
    END IF;
END
$block$;

DO $block$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'workflow_step_assignment_notify_action_check'
           AND conrelid = 'orbit_workflow.workflow_step_assignment'::regclass
    ) THEN
        ALTER TABLE orbit_workflow.workflow_step_assignment
            ADD CONSTRAINT workflow_step_assignment_notify_action_check
            CHECK ("notifyAction" IS NULL OR "notifyAction" BETWEEN 1 AND 53);
    END IF;
END
$block$;

CREATE INDEX IF NOT EXISTS ix_workflow_step_assignment_notified_date
    ON orbit_workflow.workflow_step_assignment ("notifiedDate");
