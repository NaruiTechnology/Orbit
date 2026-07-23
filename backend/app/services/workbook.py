"""Read the requirements workbook without depending on an office runtime."""

from __future__ import annotations

import hashlib
import json
import re
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

MAIN_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NAMESPACE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships"

MAIN = f"{{{MAIN_NAMESPACE}}}"
REL = f"{{{REL_NAMESPACE}}}"
PACKAGE_REL = f"{{{PACKAGE_REL_NAMESPACE}}}"


COLUMN_KEYS = {
    "阶段序号": "stage_number",
    "阶段名称": "stage_name",
    "核心环节": "core_activity",
    "责任人": "owner_role",
    "系统动作": "system_action",
    "通过条件": "success_condition",
    "异常分支": "exception_branch",
    "下一环节": "next_step",
    "关联模块": "related_module",
    "备注": "notes",
    "步骤": "step_number",
    "环节名称": "step_name",
    "时限": "time_limit",
    "序号": "sequence_number",
    "预警名称": "alert_name",
    "所属模块": "module_name",
    "触发条件": "trigger_condition",
    "预警级别": "alert_level",
    "推送对象": "notification_audience",
    "通知方式": "notification_channel",
    "通知内容摘要": "notification_summary",
    "处理动作": "resolution_action",
    "考核关联": "performance_link",
    "是否启用": "is_enabled",
    "通知场景": "notification_scenario",
    "接收人": "recipient",
    "模板标题": "template_title",
    "模板正文": "template_body",
    "是否可自定义": "is_customizable",
    "经验/话术提示": "guidance",
    "字段名称": "field_name",
    "字段类型": "field_type",
    "长度/格式": "length_or_format",
    "是否必填": "is_required",
    "校验规则": "validation_rule",
    "输入方式": "input_method",
    "默认值": "default_value",
    "回收触发条件": "reclaim_trigger",
    "判定标准": "decision_criteria",
    "回收周期选项": "reclaim_period_options",
    "预警提醒节点": "alert_milestones",
    "回收后处理": "post_reclaim_action",
    "例外情况(不回收)": "reclaim_exceptions",
    "系统实现方式": "implementation_method",
    "填写角色": "entry_role",
    "说明": "description",
    "关联流程": "related_workflow",
    "统计维度": "metric_dimension",
    "统计指标": "metric_name",
    "统计对象": "metric_subject",
    "统计周期": "metric_period",
    "数据来源": "data_source",
    "查看权限": "view_permission",
    "耗材名称": "consumable_name",
    "耗材类别": "consumable_category",
    "规格型号": "specification",
    "总库存量": "total_inventory",
    "已用量": "used_inventory",
    "剩余量": "remaining_inventory",
    "安全库存阈值": "safety_stock_threshold",
    "存放位置": "storage_location",
    "设备编号": "equipment_code",
    "设备名称": "equipment_name",
    "登记日期": "registration_date",
    "维护类型": "maintenance_type",
    "维护内容": "maintenance_content",
    "操作人": "operator",
    "耗时(小时)": "duration_hours",
    "下次计划日期": "next_planned_date",
    "设备状态": "equipment_status",
}

COLUMN_ENGLISH = {key: key.replace("_", " ").title() for key in COLUMN_KEYS.values()}
COLUMN_ENGLISH.update(
    {
        "is_enabled": "Enabled",
        "is_customizable": "Customizable",
        "is_required": "Required",
        "owner_role": "Responsible Role",
        "system_action": "System Action",
        "success_condition": "Pass Condition",
        "exception_branch": "Exception Branch",
        "next_step": "Next Step",
        "guidance": "Experience / Script Guidance",
    }
)

COLUMN_TRADITIONAL = {
    "阶段序号": "階段序號",
    "阶段名称": "階段名稱",
    "核心环节": "核心環節",
    "责任人": "責任人",
    "系统动作": "系統動作",
    "通过条件": "通過條件",
    "异常分支": "異常分支",
    "下一环节": "下一環節",
    "关联模块": "關聯模組",
    "备注": "備註",
    "步骤": "步驟",
    "环节名称": "環節名稱",
    "时限": "時限",
    "序号": "序號",
    "预警名称": "預警名稱",
    "所属模块": "所屬模組",
    "触发条件": "觸發條件",
    "预警级别": "預警級別",
    "推送对象": "推送對象",
    "通知方式": "通知方式",
    "通知内容摘要": "通知內容摘要",
    "处理动作": "處理動作",
    "考核关联": "考核關聯",
    "是否启用": "是否啟用",
    "通知场景": "通知場景",
    "接收人": "接收人",
    "模板标题": "範本標題",
    "模板正文": "範本正文",
    "是否可自定义": "是否可自訂",
    "经验/话术提示": "經驗/話術提示",
    "字段名称": "欄位名稱",
    "字段类型": "欄位類型",
    "长度/格式": "長度/格式",
    "是否必填": "是否必填",
    "校验规则": "驗證規則",
    "输入方式": "輸入方式",
    "默认值": "預設值",
    "回收触发条件": "回收觸發條件",
    "判定标准": "判定標準",
    "回收周期选项": "回收週期選項",
    "预警提醒节点": "預警提醒節點",
    "回收后处理": "回收後處理",
    "例外情况(不回收)": "例外情況(不回收)",
    "系统实现方式": "系統實作方式",
    "填写角色": "填寫角色",
    "说明": "說明",
    "关联流程": "關聯流程",
    "统计维度": "統計維度",
    "统计指标": "統計指標",
    "统计对象": "統計對象",
    "统计周期": "統計週期",
    "数据来源": "資料來源",
    "查看权限": "查看權限",
    "耗材名称": "耗材名稱",
    "耗材类别": "耗材類別",
    "规格型号": "規格型號",
    "总库存量": "總庫存量",
    "已用量": "已用量",
    "剩余量": "剩餘量",
    "安全库存阈值": "安全庫存閾值",
    "存放位置": "存放位置",
    "设备编号": "設備編號",
    "设备名称": "設備名稱",
    "登记日期": "登記日期",
    "维护类型": "維護類型",
    "维护内容": "維護內容",
    "操作人": "操作人",
    "耗时(小时)": "耗時(小時)",
    "下次计划日期": "下次計劃日期",
    "设备状态": "設備狀態",
}

# Process-tree labels are business data rather than column headers, so they
# are translated here at catalog-generation time and persisted in label_i18n.
# The source workbook currently contains only Simplified Chinese values.
RECORD_LABEL_ENGLISH = {
    "客户档案建立": "Customer Profile Setup",
    "客户跟进维护": "Customer Follow-up",
    "报价管理": "Quotation Management",
    "合同签订与审核": "Contract Signing and Review",
    "订单下达": "Order Placement",
    "技术评估": "Technical Evaluation",
    "芯片留存": "Chip Retention",
    "加工执行": "Processing Execution",
    "设备异常反馈与维修": "Equipment Incident and Repair",
    "开具费用": "Billing Preparation",
    "回访": "Customer Follow-up Visit",
    "失效分析": "Failure Analysis",
    "对账": "Account Reconciliation",
    "开票": "Invoice Issuance",
    "发票红冲": "Invoice Red Letter Reversal",
    "回款": "Payment Collection",
    "公海回收": "Public Pool Reclamation",
    "销售创建评估订单": "Sales Creates Evaluation Order",
    "系统开始计时": "System Starts Timer",
    "技术部接收评估": "Technical Team Receives Evaluation",
    "异地技术接收评估（如适用）": "Remote Technical Team Receives Evaluation (If Applicable)",
    "技术部执行评估": "Technical Team Performs Evaluation",
    "评估结果反馈": "Evaluation Result Feedback",
    "销售确认评估结果": "Sales Confirms Evaluation Result",
    "进入正式下单": "Proceed to Official Order",
    "销售提交技术工单": "Sales Submits Technical Work Order",
    "技术部接收并评估": "Technical Team Receives and Evaluates",
    "技术评估超时预警": "Technical Evaluation Timeout Alert",
    "评估结果反馈销售": "Send Evaluation Result to Sales",
    "销售确认分析结果": "Sales Confirms Analysis Result",
    "销售正式下单": "Sales Places Official Order",
    "技术接单与准备": "Technical Order Acceptance and Preparation",
    "执行开盖操作": "Perform Lid-Opening Operation",
    "技术加工执行": "Technical Processing Execution",
    "返样前检查": "Pre-Return Sample Inspection",
    "返还样品": "Return Sample",
    "客户测试反馈": "Customer Test Feedback",
    "客户决策（补做/暂停）": "Customer Decision (Redo / Pause)",
    "订单转回来源销售": "Return Order to Source Sales",
    "系统定时扫描": "Scheduled System Scan",
    "判定回收条件": "Determine Reclamation Conditions",
    "预警通知": "Alert Notification",
    "回收执行": "Execute Reclamation",
    "公海池展示": "Display in Public Pool",
    "新销售认领": "New Salesperson Claims Customer",
    "认领后跟进": "Follow-up After Claim",
    "销售选择异地实验室下单": "Sales Selects Remote Laboratory",
    "系统识别异地订单": "System Identifies Remote Order",
    "异地技术接收正式订单": "Remote Technical Team Receives Official Order",
    "设备异常上报（如发生）": "Report Equipment Incident (If Any)",
    "执行开盖与加工": "Perform Lid Opening and Processing",
    "样品寄回": "Return Sample by Shipment",
    "费用确认单生成与发送": "Generate and Send Fee Confirmation",
    "订单转单回原销售": "Transfer Order Back to Original Sales",
    "技术加工完毕": "Technical Processing Complete",
    "系统生成费用确认单": "System Generates Fee Confirmation",
    "销售确认费用信息": "Sales Confirms Fee Information",
    "发送费用确认单": "Send Fee Confirmation",
    "客户回复验收": "Customer Replies with Acceptance",
    "系统跳转回访": "System Opens Follow-up",
    "执行回访": "Perform Follow-up",
    "生成对账单": "Generate Reconciliation Statement",
    "销售发送对账单": "Sales Sends Reconciliation Statement",
    "客户确认对账": "Customer Confirms Reconciliation",
    "财务开具发票": "Finance Issues Invoice",
    "发票红冲申请": "Invoice Reversal Request",
    "预付款抵扣": "Prepayment Deduction",
    "回款机时填写反馈": "Enter Payment Collection Feedback",
    "财务导入回款": "Finance Imports Payment Collection",
    "回款跟踪与预警": "Payment Collection Tracking and Alerts",
    "招聘需求提报": "Submit Recruitment Request",
    "招聘计划制定": "Create Recruitment Plan",
    "简历筛选": "Resume Screening",
    "面试安排": "Interview Scheduling",
    "面试执行": "Conduct Interview",
    "录用决策": "Hiring Decision",
    "offer发放与确认": "Offer Issuance and Confirmation",
    "入职准备": "Onboarding Preparation",
    "入职办理": "Onboarding Processing",
    "入职培训": "Onboarding Training",
    "试用期管理": "Probation Management",
    "转正评估": "Permanent Employment Evaluation",
    "日常考勤管理": "Daily Attendance Management",
    "薪酬核算与发放": "Payroll Calculation and Payment",
    "社保公积金管理": "Social Security and Housing Fund Management",
    "绩效考核": "Performance Assessment",
    "培训与发展": "Training and Development",
    "人才盘点与晋升": "Talent Review and Promotion",
    "薪酬调整": "Compensation Adjustment",
    "岗位异动管理": "Position Change Management",
    "离职申请与审批": "Resignation Request and Approval",
    "工作交接": "Work Handover",
    "离职结算": "Offboarding Settlement",
    "离职证明开具": "Issue Separation Certificate",
    "档案转出与后续": "File Transfer and Follow-up",
    "部门提交招聘需求": "Department Submits Recruitment Request",
    "HR审核需求": "HR Reviews Request",
    "制定招聘计划": "Create Recruitment Plan",
    "简历收集与筛选": "Resume Collection and Screening",
    "电话初筛": "Phone Screening",
    "初试（HR面）": "Initial Interview (HR)",
    "复试（业务面）": "Second Interview (Business)",
    "终面（高管面）": "Final Interview (Executive)",
    "背景调查": "Background Check",
    "薪资谈判与offer发放": "Salary Negotiation and Offer Issuance",
    "入职报到": "Employee Check-in",
    "入职培训启动": "Start Onboarding Training",
    "日常打卡": "Daily Clock-in",
    "请假申请与审批": "Leave Request and Approval",
    "加班申请与审批": "Overtime Request and Approval",
    "出差申请与报销": "Business Travel Request and Reimbursement",
    "考勤汇总与异常核查": "Attendance Summary and Exception Review",
    "薪资核算": "Payroll Calculation",
    "薪资审批与发放": "Payroll Approval and Payment",
    "社保公积金核算": "Social Security and Housing Fund Calculation",
    "个税申报": "Individual Income Tax Filing",
    "年度薪酬回顾": "Annual Compensation Review",
    "制定绩效目标": "Set Performance Goals",
    "过程跟踪与辅导": "Progress Tracking and Coaching",
    "期中回顾": "Midterm Review",
    "期末考核评分": "Final Performance Scoring",
    "绩效面谈": "Performance Discussion",
    "绩效结果应用": "Apply Performance Results",
    "培训需求分析": "Training Needs Analysis",
    "培训实施": "Deliver Training",
    "培训效果评估": "Evaluate Training Effectiveness",
    "人才盘点与继任计划": "Talent Review and Succession Planning",
    "技术能力评估": "Technical Capability Evaluation",
    "技术培训需求分析": "Technical Training Needs Analysis",
    "设备能力评估": "Equipment Capability Evaluation",
    "设备培训需求分析": "Equipment Training Needs Analysis",
    "员工提交离职申请": "Employee Submits Resignation",
    "直属上级沟通": "Direct Manager Discussion",
    "HR离职面谈": "HR Exit Interview",
    "离职审批": "Resignation Approval",
    "工作交接计划": "Work Handover Plan",
    "工作交接执行": "Execute Work Handover",
    "资产回收": "Asset Recovery",
    "薪资与福利结算": "Salary and Benefits Settlement",
    "社保公积金处理": "Social Security and Housing Fund Processing",
    "档案转出": "Transfer Personnel File",
    "离职后跟进": "Post-Departure Follow-up",
    "技术填写设备故障表": "Technical team completes the equipment fault form",
    "设备部接收故障工单": "Equipment department receives the fault work order",
    "各实验室设备员维修": "Laboratory equipment technician performs the repair",
    "升级至设备经理": "Escalate to the equipment manager",
    "维修受阻统计": "Track blocked repairs",
    "维修完成验收": "Accept the completed repair",
    "设备空时率统计": "Track equipment idle time",
    "维修时长统计": "Track repair duration",
    "设备状态更新": "Update equipment status",
}

SIMPLIFIED_TO_TRADITIONAL = str.maketrans(
    "客户档案建立进维护报价管理签订审订单下达技术评估芯片留存加工执行设备异常反馈与维修开具费用回访失效分析对账开票发票红冲款公海收销售创建系统开始计时部接异地如适用结果确正式单提交工工接并超时预警知判定条件池展示新认领后跟踪选择实验室识别返样前检查还品测试决策补做暂停生成发送信息回复验收跳转财务申请抵扣填写导入",
    "客戶檔案建立進維護報價管理簽訂審訂單下達技術評估晶片留存加工執行設備異常反饋與維修開具費用回訪失效分析對賬開票發票紅沖款公海收銷售創建系統開始計時部接異地如適用結果確正式單提交工工接並超時預警知判定條件池展示新認領後跟踪選擇實驗室識別返樣前檢查還品測試決策補做暫停生成發送信息回復驗收跳轉財務申請抵扣填寫導入",
)


def _record_label_i18n(label: str) -> dict[str, str]:
    return {
        "en": RECORD_LABEL_ENGLISH.get(label, label),
        "zh_CN": label,
        "zh_HK": label.translate(SIMPLIFIED_TO_TRADITIONAL),
    }


SHEET_METADATA = {
    "全流程图": ("master-workflow", "Full Workflow", "全流程圖", "sales", "master"),
    "下单评估流程": ("order-evaluation", "Order Evaluation", "下單評估流程", "sales", "workflow"),
    "预警规则总览": (
        "business-alert-rules",
        "Business Alert Rules",
        "預警規則總覽",
        "sales",
        "lookup_table",
    ),
    "通知模板配置": (
        "business-notification-templates",
        "Business Notification Templates",
        "通知範本設定",
        "sales",
        "lookup_table",
    ),
    "异地实验室下单流程": (
        "cross-laboratory-orders",
        "Cross-Laboratory Orders",
        "異地實驗室下單流程",
        "sales",
        "workflow",
    ),
    "对账开票回款流程": (
        "billing-and-collection",
        "Billing and Collection",
        "對帳開票回款流程",
        "sales",
        "workflow",
    ),
    "销售公海回收流程": (
        "customer-pool-reclaim",
        "Customer Pool Reclaim",
        "銷售公海回收流程",
        "sales",
        "workflow",
    ),
    "客户档案": (
        "customer-fields",
        "Customer Profile Fields",
        "客戶檔案",
        "sales",
        "data_dictionary",
    ),
    "客户公海": ("customer-pool-rules", "Customer Pool Rules", "客戶公海", "sales", "lookup_table"),
    "HR全流程总览": ("hr-master-workflow", "HR Full Workflow", "HR全流程總覽", "hr", "workflow"),
    "招聘全流程": ("recruitment", "Recruitment", "招聘全流程", "hr", "workflow"),
    "考勤与薪酬管理": (
        "attendance-and-payroll",
        "Attendance and Payroll",
        "考勤與薪酬管理",
        "hr",
        "workflow",
    ),
    "绩效与培训发展": (
        "performance-and-development",
        "Performance and Development",
        "績效與培訓發展",
        "hr",
        "workflow",
    ),
    "离职全流程": ("offboarding", "Offboarding", "離職全流程", "hr", "workflow"),
    "HR预警规则总览": ("hr-alert-rules", "HR Alert Rules", "HR預警規則總覽", "hr", "rule_catalog"),
    "员工档案字段": (
        "employee-fields",
        "Employee Profile Fields",
        "員工檔案欄位",
        "hr",
        "data_dictionary",
    ),
    "HR通知模板配置": (
        "hr-notification-templates",
        "HR Notification Templates",
        "HR通知範本設定",
        "hr",
        "lookup_table",
    ),
    "技术接单评估流程": (
        "technical-intake",
        "Technical Intake Evaluation",
        "技術接單評估流程",
        "operations",
        "workflow",
    ),
    "技术加工执行流程": (
        "technical-processing",
        "Technical Processing",
        "技術加工執行流程",
        "operations",
        "workflow",
    ),
    "失效分析管理": (
        "failure-analysis",
        "Failure Analysis",
        "失效分析管理",
        "operations",
        "data_dictionary",
    ),
    "技术、设备统计数据": (
        "technical-equipment-metrics",
        "Technical and Equipment Metrics",
        "技術、設備統計資料",
        "operations",
        "metric_catalog",
    ),
    "设备管理与维护": (
        "equipment-maintenance",
        "Equipment Maintenance",
        "設備管理與維護",
        "operations",
        "workflow",
    ),
    "耗材台账管理": (
        "consumables-ledger",
        "Consumables Ledger",
        "耗材台帳管理",
        "operations",
        "ledger",
    ),
    "设备日常管理登记及统计": (
        "equipment-daily-register",
        "Equipment Daily Register",
        "設備日常管理登記及統計",
        "operations",
        "ledger",
    ),
}

GROUP_NAMES = {
    "sales": {"en": "Customer & Revenue", "zh_CN": "客户与营收", "zh_HK": "客戶與營收"},
    "hr": {"en": "People Operations", "zh_CN": "人力资源", "zh_HK": "人力資源"},
    "operations": {"en": "Technical Operations", "zh_CN": "技术运营", "zh_HK": "技術營運"},
}

BOOLEAN_COLUMNS = {"is_enabled", "is_customizable", "is_required"}
INTEGER_COLUMNS = {
    "stage_number",
    "step_number",
    "sequence_number",
    "total_inventory",
    "used_inventory",
    "remaining_inventory",
    "safety_stock_threshold",
}
DECIMAL_COLUMNS = {"duration_hours"}
DATE_COLUMNS = {"registration_date", "next_planned_date"}
LABEL_KEYS = (
    "stage_name",
    "step_name",
    "alert_name",
    "notification_scenario",
    "field_name",
    "metric_name",
    "consumable_name",
    "equipment_name",
    "reclaim_trigger",
)


@dataclass(frozen=True)
class CellValue:
    reference: str
    value: Any


@dataclass(frozen=True)
class WorkbookSheet:
    title: str
    index: int
    rows: list[dict[str, CellValue]]
    merged_ranges: list[str]


def _column_index(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference)
    if letters is None:
        raise ValueError(f"Invalid cell reference: {reference}")
    result = 0
    for character in letters.group(0):
        result = result * 26 + ord(character) - ord("A") + 1
    return result


def _cell_value(cell: ElementTree.Element, shared_strings: list[str]) -> Any:
    cell_type = cell.attrib.get("t")
    value_node = cell.find(f"{MAIN}v")
    if cell_type == "inlineStr":
        inline = cell.find(f"{MAIN}is")
        if inline is None:
            return None
        return "".join(node.text or "" for node in inline.iter(f"{MAIN}t"))
    if value_node is None or value_node.text is None:
        return None
    raw_value = value_node.text
    if cell_type == "s":
        return shared_strings[int(raw_value)]
    if cell_type in {"str", "e"}:
        return raw_value
    if cell_type == "b":
        return raw_value == "1"
    try:
        numeric = float(raw_value)
        return int(numeric) if numeric.is_integer() else numeric
    except ValueError:
        return raw_value


def read_workbook(path: Path) -> list[WorkbookSheet]:
    """Return ordered worksheet cells from an XLSX Open Packaging archive."""

    with zipfile.ZipFile(path) as archive:
        shared_root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
        shared_strings = [
            "".join(node.text or "" for node in item.iter(f"{MAIN}t"))
            for item in shared_root.findall(f"{MAIN}si")
        ]
        workbook_root = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        relationships_root = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {
            relationship.attrib["Id"]: relationship.attrib["Target"]
            for relationship in relationships_root.findall(f"{PACKAGE_REL}Relationship")
        }

        sheets: list[WorkbookSheet] = []
        sheet_nodes = workbook_root.find(f"{MAIN}sheets")
        if sheet_nodes is None:
            return sheets
        for index, sheet_node in enumerate(sheet_nodes, start=1):
            target = targets[sheet_node.attrib[f"{REL}id"]]
            sheet_path = target if target.startswith("xl/") else f"xl/{target.lstrip('/')}"
            root = ElementTree.fromstring(archive.read(sheet_path))
            rows: list[dict[str, CellValue]] = []
            for row_node in root.findall(f".//{MAIN}sheetData/{MAIN}row"):
                row: dict[str, CellValue] = {}
                for cell in row_node.findall(f"{MAIN}c"):
                    reference = cell.attrib["r"]
                    value = _cell_value(cell, shared_strings)
                    if value not in (None, ""):
                        row[reference] = CellValue(reference=reference, value=value)
                if row:
                    rows.append(row)
            merge_node = root.find(f"{MAIN}mergeCells")
            merged_ranges = (
                [item.attrib["ref"] for item in merge_node] if merge_node is not None else []
            )
            sheets.append(
                WorkbookSheet(
                    title=sheet_node.attrib["name"],
                    index=index,
                    rows=rows,
                    merged_ranges=merged_ranges,
                )
            )
        return sheets


def _header_row(sheet: WorkbookSheet) -> tuple[int, list[CellValue]]:
    candidates = sheet.rows[:5]
    if not candidates:
        raise ValueError(f"Worksheet '{sheet.title}' has no populated rows")
    header = max(candidates, key=len)
    cells = sorted(header.values(), key=lambda item: _column_index(item.reference))
    row_number = int(re.search(r"\d+", cells[0].reference).group(0))
    return row_number, cells


def _data_type(column_key: str) -> str:
    if column_key in BOOLEAN_COLUMNS:
        return "boolean"
    if column_key in INTEGER_COLUMNS:
        return "integer"
    if column_key in DECIMAL_COLUMNS:
        return "decimal"
    if column_key in DATE_COLUMNS:
        return "date"
    return "text"


def _coerce_value(column_key: str, value: Any) -> Any:
    if value in (None, ""):
        return None
    if column_key in BOOLEAN_COLUMNS and isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"是", "yes", "true", "1", "启用", "啟用"}:
            return True
        if normalized in {"否", "no", "false", "0", "禁用"}:
            return False
    if column_key in INTEGER_COLUMNS and isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _localized(
    value: str, english: str | None = None, traditional: str | None = None
) -> dict[str, str]:
    return {
        "en": english or value,
        "zh_CN": value,
        "zh_HK": traditional or value,
    }


def _label_for(values: dict[str, Any], fallback: str) -> str:
    for key in LABEL_KEYS:
        value = values.get(key)
        if value not in (None, ""):
            return str(value)
    for value in values.values():
        if value not in (None, ""):
            return str(value)
    return fallback


def _edge_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    edges: list[dict[str, Any]] = []
    for position, record in enumerate(records[:-1]):
        next_record = records[position + 1]
        explicit_label = record["values"].get("next_step")
        edges.append(
            {
                "source": record["record_key"],
                "target": next_record["record_key"],
                "kind": "explicit" if explicit_label else "sequence",
                "label": explicit_label,
            }
        )
    return edges


def build_catalog(source: Path) -> dict[str, Any]:
    """Transform workbook sheets into API-ready workflow definitions."""

    workflows: list[dict[str, Any]] = []
    for sheet in read_workbook(source):
        if sheet.title not in SHEET_METADATA:
            raise ValueError(f"No English metadata mapping for worksheet '{sheet.title}'")
        key, english_name, traditional_name, group, definition_type = SHEET_METADATA[sheet.title]
        header_row, header_cells = _header_row(sheet)
        header_by_column: dict[int, tuple[str, str, str]] = {}
        columns: list[dict[str, Any]] = []
        duplicate_keys: dict[str, int] = {}
        for cell in header_cells:
            source_label = str(cell.value).strip()
            base_key = COLUMN_KEYS.get(source_label)
            if base_key is None:
                base_key = re.sub(r"[^a-z0-9]+", "_", source_label.lower()).strip("_")
                if not base_key:
                    base_key = f"column_{_column_index(cell.reference)}"
            duplicate_keys[base_key] = duplicate_keys.get(base_key, 0) + 1
            column_key = (
                base_key
                if duplicate_keys[base_key] == 1
                else f"{base_key}_{duplicate_keys[base_key]}"
            )
            column_number = _column_index(cell.reference)
            header_by_column[column_number] = (column_key, source_label, cell.reference)
            columns.append(
                {
                    "key": column_key,
                    "source_label": source_label,
                    "label_i18n": _localized(
                        source_label,
                        COLUMN_ENGLISH.get(base_key, source_label),
                        COLUMN_TRADITIONAL.get(source_label, source_label),
                    ),
                    "data_type": _data_type(base_key),
                    "editable": base_key not in {"stage_number", "step_number", "sequence_number"},
                    "source_cell": cell.reference,
                }
            )

        records: list[dict[str, Any]] = []
        for row in sheet.rows:
            first_cell = min(row.values(), key=lambda item: _column_index(item.reference))
            source_row = int(re.search(r"\d+", first_cell.reference).group(0))
            if source_row <= header_row:
                continue
            values: dict[str, Any] = {}
            source_cells: dict[str, str] = {}
            for cell in row.values():
                column_number = _column_index(cell.reference)
                header = header_by_column.get(column_number)
                if header is None:
                    continue
                column_key = header[0]
                values[column_key] = _coerce_value(column_key, cell.value)
                source_cells[column_key] = cell.reference
            if not values:
                continue
            record_key = f"{key}-{source_row:03d}"
            label = _label_for(values, f"Row {source_row}")
            records.append(
                {
                    "record_key": record_key,
                    "record_order": len(records) + 1,
                    "source_row": source_row,
                    "label_i18n": _record_label_i18n(label),
                    "values": values,
                    "source_cells": source_cells,
                }
            )

        workflows.append(
            {
                "key": key,
                "source_sheet": sheet.title,
                "source_sheet_index": sheet.index,
                "name_i18n": _localized(sheet.title, english_name, traditional_name),
                "group_key": group,
                "group_name_i18n": GROUP_NAMES[group],
                "definition_type": definition_type,
                "is_master": sheet.title == "全流程图",
                "parent_key": None if sheet.title == "全流程图" else "master-workflow",
                "display_order": sheet.index,
                "header_row": header_row,
                "merged_ranges": sheet.merged_ranges,
                "columns": columns,
                "records": records,
                "edges": _edge_records(records),
            }
        )

    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    return {
        "catalog_version": 1,
        "source_file": source.name,
        "source_sha256": digest,
        "encoding": "UTF-8",
        "source_timezone": "Asia/Shanghai",
        "supported_locales": ["en", "zh_CN", "zh_HK"],
        "workflows": workflows,
    }


def write_catalog(catalog: dict[str, Any], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def workflow_counts(catalog: dict[str, Any]) -> Iterable[tuple[str, int]]:
    for workflow in catalog["workflows"]:
        yield workflow["key"], len(workflow["records"])
