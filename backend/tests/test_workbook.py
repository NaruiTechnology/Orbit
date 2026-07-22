from pathlib import Path

from app.services.workbook import build_catalog

WORKBOOK = Path.home() / "Downloads" / "单束系统 初版.xlsx"


def test_workbook_catalog_preserves_all_sheets() -> None:
    catalog = build_catalog(WORKBOOK)

    assert catalog["encoding"] == "UTF-8"
    assert len(catalog["workflows"]) == 24
    assert catalog["workflows"][0]["key"] == "master-workflow"
    assert catalog["workflows"][0]["is_master"] is True
    assert catalog["workflows"][1]["parent_key"] == "master-workflow"


def test_code_facing_headers_are_normalized_to_english() -> None:
    catalog = build_catalog(WORKBOOK)
    master = catalog["workflows"][0]

    assert master["columns"][0]["key"] == "stage_number"
    assert master["columns"][1]["key"] == "stage_name"
    assert master["records"][0]["values"]["stage_name"] == "客户档案建立"
    assert master["records"][0]["source_cells"]["stage_name"] == "B2"


def test_catalog_contains_language_keys() -> None:
    catalog = build_catalog(WORKBOOK)
    workflow = catalog["workflows"][4]

    assert workflow["name_i18n"]["en"] == "Cross-Laboratory Orders"
    assert workflow["name_i18n"]["zh_CN"] == "异地实验室下单流程"
    assert workflow["name_i18n"]["zh_HK"] == "異地實驗室下單流程"


def test_workflow_tree_record_labels_are_localized() -> None:
    catalog = build_catalog(WORKBOOK)
    record = catalog["workflows"][0]["records"][0]

    assert record["label_i18n"] == {
        "en": "Customer Profile Setup",
        "zh_CN": "客户档案建立",
        "zh_HK": "客戶檔案建立",
    }


def test_notification_templates_are_lookup_tables_not_workflows() -> None:
    catalog = build_catalog(WORKBOOK)
    definitions = {workflow["key"]: workflow for workflow in catalog["workflows"]}

    assert definitions["business-notification-templates"]["definition_type"] == "lookup_table"
    assert definitions["business-alert-rules"]["definition_type"] == "lookup_table"
    assert definitions["customer-pool-rules"]["definition_type"] == "lookup_table"
    assert definitions["hr-notification-templates"]["definition_type"] == "lookup_table"


def test_order_evaluation_drops_duplicate_official_order_step() -> None:
    catalog = build_catalog(WORKBOOK)
    workflow = next(item for item in catalog["workflows"] if item["key"] == "order-evaluation")

    assert [record["record_key"] for record in workflow["records"]] == [
        "order-evaluation-002",
        "order-evaluation-003",
        "order-evaluation-004",
        "order-evaluation-005",
        "order-evaluation-006",
        "order-evaluation-007",
        "order-evaluation-008",
        "order-evaluation-009",
    ]
    assert len(workflow["edges"]) == 7
    assert workflow["edges"][-1]["target"] == "order-evaluation-009"
