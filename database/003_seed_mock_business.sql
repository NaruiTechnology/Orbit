-- Development-only business data. The script that executes this file is
-- intentionally opt-in; this file is not part of the normal catalog bootstrap.

INSERT INTO orbit_sales.customer_order (
    id, order_number, customer_code, customer_name, customer_contact,
    chip_name, chip_model, package_type, quantity, source_laboratory,
    target_laboratory, requested_due_date, priority, status, evaluation_result,
    notes, organization_id, department_id, laboratory_id, created_by
)
VALUES
    (
        '71000000-0000-0000-0000-000000000001', 'MOCK-ORD-0001', 'CUST-001',
        '华芯微电子 / Huaxin Microelectronics', '林敏 / Min Lin',
        'Power Controller', 'HX-PM-2401', 'QFN', 1200, 'LAB-01', 'LAB-01',
        CURRENT_DATE + 14, 'high', 'under_evaluation', 'Pending technical review',
        'Development fixture order with mixed-language customer data.',
        '10000000-0000-0000-0000-000000000001',
        NULL,
        NULL,
        '60000000-0000-0000-0000-000000000001'
    ),
    (
        '71000000-0000-0000-0000-000000000002', 'MOCK-ORD-0002', 'CUST-002',
        'Northstar Devices', 'Emma Carter',
        'Sensor Array', 'NS-SN-880', 'BGA', 480, 'LAB-02', 'LAB-04',
        CURRENT_DATE + 21, 'normal', 'submitted', NULL,
        'Remote-laboratory evaluation scenario.',
        '10000000-0000-0000-0000-000000000001',
        NULL,
        NULL,
        '60000000-0000-0000-0000-000000000001'
    ),
    (
        '71000000-0000-0000-0000-000000000003', 'MOCK-ORD-0003', 'CUST-003',
        '晶量科技 / Crystal Measure', '赵强 / Qiang Zhao',
        'RF Amplifier', 'CM-RF-310', 'LGA', 96, 'LAB-03', 'LAB-03',
        CURRENT_DATE + 7, 'urgent', 'approved', 'Approved for processing',
        'Urgent development sample; test feedback is required after return.',
        '10000000-0000-0000-0000-000000000001',
        NULL,
        NULL,
        '60000000-0000-0000-0000-000000000001'
    )
ON CONFLICT (id) DO UPDATE SET
    order_number = EXCLUDED.order_number,
    customer_name = EXCLUDED.customer_name,
    department_id = EXCLUDED.department_id,
    laboratory_id = EXCLUDED.laboratory_id,
    status = EXCLUDED.status,
    evaluation_result = EXCLUDED.evaluation_result,
    notes = EXCLUDED.notes,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO orbit_workflow.workflow_business_record (
    workflow_id, record_key, record_order, label_i18n, values_json,
    source_row, source_cells
)
SELECT
    definition.id,
    'mock-' || definition.workflow_key,
    9001,
    jsonb_build_object(
        'en', 'Mock business record',
        'zh_CN', '模拟业务记录',
        'zh_HK', '模擬業務記錄'
    ),
    jsonb_build_object(
        'mock_data', true,
        'scenario', 'Development fixture',
        'workflow_key', definition.workflow_key
    ),
    NULL,
    '{}'::jsonb
FROM orbit_workflow.workflow_definition definition
WHERE definition.definition_type = 'workflow'
  AND definition.workflow_key <> 'order-evaluation'
ON CONFLICT (workflow_id, record_key) DO UPDATE SET
    label_i18n = EXCLUDED.label_i18n,
    values_json = EXCLUDED.values_json,
    updated_at = CURRENT_TIMESTAMP;

-- Give every mock grid row values for every imported column, so AG Grid can
-- exercise sorting, filtering, rendering, and editing instead of showing an
-- otherwise empty placeholder row.
UPDATE orbit_workflow.workflow_business_record record
SET values_json = mock_values.values_json,
    updated_at = CURRENT_TIMESTAMP
FROM (
    SELECT
        definition.id AS workflow_id,
        jsonb_object_agg(
            column_definition->>'key',
            CASE column_definition->>'data_type'
                WHEN 'boolean' THEN 'false'::jsonb
                WHEN 'integer' THEN '1'::jsonb
                WHEN 'decimal' THEN '1.0'::jsonb
                ELSE to_jsonb('Mock data · ' || (column_definition->>'key'))
            END
        ) || jsonb_build_object(
            'mock_data', true,
            'scenario', 'Development fixture'
        ) AS values_json
    FROM orbit_workflow.workflow_definition definition
    CROSS JOIN LATERAL jsonb_array_elements(definition.schema_json) AS column_definition
    WHERE definition.definition_type = 'workflow'
      AND definition.workflow_key <> 'order-evaluation'
    GROUP BY definition.id
) mock_values
WHERE record.workflow_id = mock_values.workflow_id
  AND record.record_key = 'mock-' || (
      SELECT workflow_key
      FROM orbit_workflow.workflow_definition
      WHERE id = mock_values.workflow_id
  );

INSERT INTO orbit_runtime.workflow_instance (
    id, workflow_id, business_key, current_record_key, status, context_json,
    organization_id, department_id, laboratory_id, started_by
)
SELECT
    seed.id,
    definition.id,
    seed.business_key,
    (
        SELECT record_key
        FROM orbit_workflow.workflow_record
        WHERE workflow_id = definition.id
        ORDER BY record_order
        LIMIT 1
    ),
    seed.status,
    seed.context_json::jsonb,
    '10000000-0000-0000-0000-000000000001',
    seed.department_id,
    seed.laboratory_id,
    '60000000-0000-0000-0000-000000000001'
FROM (
    VALUES
        ('72000000-0000-0000-0000-000000000001'::uuid, 'technical-intake', 'MOCK-CASE-0001', 'active', '{"order_number":"MOCK-ORD-0001","scenario":"technical review"}', '20000000-0000-0000-0000-000000000003'::uuid, '30000000-0000-0000-0000-000000000001'::uuid),
        ('72000000-0000-0000-0000-000000000002'::uuid, 'technical-processing', 'MOCK-CASE-0002', 'waiting', '{"order_number":"MOCK-ORD-0003","scenario":"customer test feedback"}', '20000000-0000-0000-0000-000000000003'::uuid, '30000000-0000-0000-0000-000000000003'::uuid),
        ('72000000-0000-0000-0000-000000000003'::uuid, 'cross-laboratory-orders', 'MOCK-CASE-0003', 'completed', '{"order_number":"MOCK-ORD-0002","scenario":"remote laboratory"}', '20000000-0000-0000-0000-000000000003'::uuid, '30000000-0000-0000-0000-000000000004'::uuid)
) AS seed(id, workflow_key, business_key, status, context_json, department_id, laboratory_id)
JOIN orbit_workflow.workflow_definition definition
  ON definition.workflow_key = seed.workflow_key
ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    context_json = EXCLUDED.context_json,
    current_record_key = EXCLUDED.current_record_key,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO orbit_runtime.workflow_task (
    id, instance_id, record_key, assigned_role_id, assigned_user_id,
    state, due_at, payload
)
SELECT
    task.id,
    instance.id,
    instance.current_record_key,
    '40000000-0000-0000-0000-000000000003',
    '60000000-0000-0000-0000-000000000001',
    task.state,
    CURRENT_TIMESTAMP + task.due_offset,
    task.payload::jsonb
FROM (
    VALUES
        ('73000000-0000-0000-0000-000000000001'::uuid, 'MOCK-CASE-0001', 'open'::varchar, interval '2 days', '{"priority":"high","note":"Review customer requirements"}'),
        ('73000000-0000-0000-0000-000000000002'::uuid, 'MOCK-CASE-0002', 'claimed'::varchar, interval '1 day', '{"priority":"urgent","note":"Await customer test result"}'),
        ('73000000-0000-0000-0000-000000000003'::uuid, 'MOCK-CASE-0003', 'completed'::varchar, interval '-1 day', '{"priority":"normal","note":"Remote laboratory completed"}')
) AS task(id, business_key, state, due_offset, payload)
JOIN orbit_runtime.workflow_instance instance
  ON instance.business_key = task.business_key
ON CONFLICT (id) DO UPDATE SET
    state = EXCLUDED.state,
    due_at = EXCLUDED.due_at,
    payload = EXCLUDED.payload;

INSERT INTO orbit_runtime.transition_event (
    id, instance_id, from_record_key, to_record_key, outcome, payload, actor_user_id
)
OVERRIDING SYSTEM VALUE
SELECT
    seed.id,
    instance.id,
    NULL,
    instance.current_record_key,
    seed.outcome,
    seed.payload::jsonb,
    '60000000-0000-0000-0000-000000000001'
FROM (
    VALUES
        (74000001, 'MOCK-CASE-0001', 'started', '{"source":"mock seed"}'),
        (74000002, 'MOCK-CASE-0002', 'waiting', '{"source":"mock seed","reason":"customer test"}'),
        (74000003, 'MOCK-CASE-0003', 'completed', '{"source":"mock seed"}')
) AS seed(id, business_key, outcome, payload)
JOIN orbit_runtime.workflow_instance instance
  ON instance.business_key = seed.business_key
ON CONFLICT (id) DO NOTHING;
