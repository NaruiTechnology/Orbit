import { useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridApi, ICellRendererParams } from "ag-grid-community";
import type { Locale, ThemeMode } from "../types";
import { useCreateBusinessEntityRecordMutation, useDeleteBusinessEntityRecordMutation, useGetBusinessEntitiesQuery, useUpdateBusinessEntityRecordMutation } from "../app/orbitApi";
import type { BusinessEntityDescriptor, BusinessEntityRecord } from "../salesTypes";
import { translate } from "../i18n/translations";
import { orbitGridBlackTheme, orbitGridGreenTheme, orbitGridNavyTheme, orbitGridTheme } from "./WorkflowGrid";

type TemplateWidget = "text" | "textarea" | "number" | "date" | "select" | "multiselect";

interface LocalizedOption {
  value: string;
  en: string;
  zhCN: string;
  zhHK: string;
}

interface TemplateField {
  key: string;
  en: string;
  zhCN: string;
  zhHK: string;
  widget: TemplateWidget;
  required?: boolean;
  defaultValue?: string;
  options?: LocalizedOption[];
}

interface SalesTemplate {
  key: string;
  en: string;
  zhCN: string;
  zhHK: string;
  fields: TemplateField[];
}

const yesNo: LocalizedOption[] = [
  { value: "是", en: "Yes", zhCN: "是", zhHK: "是" },
  { value: "否", en: "No", zhCN: "否", zhHK: "否" },
];
const option = (value: string, en: string, zhCN = value, zhHK = zhCN): LocalizedOption => ({ value, en, zhCN, zhHK });
const localizedField = (key: string, en: string, zhCN: string, widget: TemplateWidget, zhHKOrRequired: string | boolean = zhCN, required = false): TemplateField => {
  const zhHK = typeof zhHKOrRequired === "string" ? zhHKOrRequired : zhCN;
  return { key, en, zhCN, zhHK, widget, ...(typeof zhHKOrRequired === "boolean" ? { required: zhHKOrRequired } : { required }) };
};
const text = (key: string, en: string, zhCN: string, zhHKOrRequired: string | boolean = zhCN, required = false): TemplateField => localizedField(key, en, zhCN, "text", zhHKOrRequired, required);
const number = (key: string, en: string, zhCN: string, zhHKOrRequired: string | boolean = zhCN, required = false): TemplateField => localizedField(key, en, zhCN, "number", zhHKOrRequired, required);
const date = (key: string, en: string, zhCN: string, zhHKOrRequired: string | boolean = zhCN, required = false): TemplateField => localizedField(key, en, zhCN, "date", zhHKOrRequired, required);
const select = (key: string, en: string, zhCN: string, options: LocalizedOption[], defaultValue?: string, required = false): TemplateField => ({ key, en, zhCN, zhHK: zhCN, widget: "select", options, ...(defaultValue === undefined ? {} : { defaultValue }), ...(required ? { required: true } : {}) });
const area = (key: string, en: string, zhCN: string, zhHKOrRequired: string | boolean = zhCN, required = false): TemplateField => localizedField(key, en, zhCN, "textarea", zhHKOrRequired, required);

const customerTemplates: SalesTemplate[] = [
  {
    key: "customer-profile", en: "Customer Profile", zhCN: "客户档案", zhHK: "客戶檔案",
    fields: [
      text("short_name", "Short name", "客户简称", "客戶簡稱", true), text("customer_code", "Customer code", "客户代码", "客戶代碼", true), text("website", "Website", "公司网址", "公司網址"), text("primary_contact_name", "Primary contact", "联系人(主)", "聯絡人(主)", true), text("landline", "Landline", "固定电话", "固定電話"), text("primary_mobile", "Primary mobile", "手机号码(主)", "手機號碼(主)", true), text("primary_email", "Primary email", "邮箱(主)", "電郵(主)"), text("chip_application_category", "Chip application category", "芯片分类(应用方向)", "晶片分類(應用方向)", true), text("source", "Source", "客户来源", "客戶來源", true), select("stage", "Customer stage", "客户阶段", [option("新客户开发", "New customer development"), option("老客户流失挽回", "Win-back")], "新客户开发", true), select("status", "Status", "客户状态", [option("未成交", "Not converted"), option("已成交", "Converted")], "未成交", true), select("lock_status", "Lock status", "客户锁定", [option("未锁定", "Unlocked"), option("已锁定", "Locked")], "未锁定", true), select("level", "Customer level", "客户级别", [option("一级", "Tier 1", "一级"), option("二级", "Tier 2", "二级"), option("三级", "Tier 3", "三级")], "二级", true), text("competitors", "Competitors", "竞争对手", "競爭對手"), text("investor", "Investor", "投资方", "投資方"), text("core_team_background", "Core team background", "核心团队成员背景", "核心團隊成員背景"), text("laboratory_id", "Laboratory", "所属实验室", "所屬實驗室", true), text("sales_owner_id", "Sales owner", "销售负责人", "銷售負責人", true), number("public_pool_countdown_days", "Public pool countdown", "公海倒计时天数", false),
    ],
  },
  {
    key: "billing-information", en: "Billing Information", zhCN: "开票信息", zhHK: "開票資訊",
    fields: [
      text("invoice_title", "Invoice title", "发票抬头", "發票抬頭", true), text("tax_number", "Tax number", "税号", "稅號", true), text("business_license_attachment_id", "Business license", "营业执照附件", "營業執照附件", true), text("address", "Address", "地址", "地址", true), text("invoice_laboratory", "Invoice laboratory", "开票实验室", "開票實驗室", true), select("invoice_type", "Invoice type", "发票类型", [option("增值税普通发票-电子", "VAT ordinary e-invoice"), option("增值税专用发票-电子", "VAT special e-invoice")], "增值税普通发票-电子", true), select("tax_rate", "Tax rate", "发票税率", [option("1%", "1%"), option("3%", "3%"), option("6%", "6%"), option("9%", "9%"), option("13%", "13%" )], "6%", true), text("invoice_item", "Invoice item", "开票项目", "開票項目", true), select("settlement_method", "Settlement method", "结款方式", [option("月结", "Monthly"), option("季度结", "Quarterly"), option("半年度结", "Semi-annual"), option("充值扣款结算", "Prepaid deduction")], "月结", true), select("invoice_format", "Invoice format", "发票格式", [option("PDF", "PDF"), option("OFD", "OFD"), option("XML", "XML")], "PDF", true), text("finance_contact", "Finance contact", "账务联系人", "帳務聯絡人", true), text("finance_phone", "Finance phone", "联系电话", "聯絡電話", true), text("reconciliation_email", "Reconciliation email", "对账邮箱", "對賬電郵", true),
    ],
  },
  {
    key: "quotation", en: "Quotation", zhCN: "报价单", zhHK: "報價單",
    fields: [
      text("quotation_number", "Quotation number", "报价编号", "報價編號", true), date("valid_until", "Valid until", "报价有效期", "報價有效期", true), number("decap_count", "DECAP", "DECAP"), number("fib_hours", "FIB hours", "FIB小时", true), number("fib_normal_glue_hours", "FIB normal glue", "FIB-普通胶", true), number("fib_high_temperature_glue_hours", "FIB high-temperature glue", "FIB-高温胶", true), number("manual_wire_pick_hours", "Manual wire pick", "手工挑线", true), number("equipment_wire_cut_hours", "Equipment wire cut", "设备切线", true), number("equipment_pi_removal_hours", "Equipment PI removal", "设备去PI", true), number("solder_ball_removal_count", "Solder ball removal", "去锡球", true), number("copper_pillar_removal_count", "Copper pillar removal", "去铜柱", true), number("ball_planting_count", "Ball planting", "植球", true), number("pcb_mounting_fee_count", "PCB mounting", "PCB板上样费", true), number("chemical_pi_removal_count", "Chemical PI removal", "化学去PI", true), number("au_bond_wire_count", "Au bond wire", "Au金绑线", true), number("cu_bond_wire_count", "Cu bond wire", "Cu金绑线", true), number("alloy_al_special_bond_wire_count", "Alloy / Al / special wire", "合金/铝/特殊", true), number("om_photo_count", "OM photo", "OM拍照", true), number("cross_section_analysis_count", "Cross-section analysis", "截面分析", true), select("has_discount", "Has discount", "是否有折扣", yesNo, "否", true), area("discount_details", "Discount details", "折扣明细", "折扣明細", true), number("outsourced_project_count", "Outsourced projects", "外包项目", true),
    ],
  },
  {
    key: "contract", en: "Contract", zhCN: "合同管理", zhHK: "合約管理",
    fields: [text("name", "Contract name", "合同名称", "合約名稱", true), text("contract_number", "Contract number", "合同编号", "合約編號", true), number("amount", "Amount", "合同金额", true), date("signed_on", "Signed on", "签约日期", "簽約日期", true), date("starts_on", "Starts on", "开始日期", "開始日期", true), date("ends_on", "Ends on", "结束日期", "結束日期", true), text("signing_company", "Signing company", "签约公司", "簽約公司", true), select("review_status", "Review status", "审核状态", [option("待审核", "Pending review"), option("已审核", "Reviewed")], "待审核", true), text("signing_contact", "Signing contact", "公司签约人", "公司簽約人", true), text("owner", "Owner", "负责人", "負責人", true), area("notes", "Notes", "备注", "備註"), text("attachment_id", "Attachment", "上传附件", "上傳附件", true), select("contract_type", "Contract type", "合同类型", [option("技术服务合同", "Technical services contract"), option("销售合同", "Sales contract"), option("保密合同", "Confidentiality agreement"), option("其他", "Other")], "技术服务合同", true), select("fulfillment_status", "Fulfillment status", "履约状态", [option("执行中", "In progress"), option("已完结", "Completed"), option("终止", "Terminated")], "执行中", true)],
  },
  {
    key: "sales-order", en: "Sales Order", zhCN: "下单界面", zhHK: "落單介面",
    fields: [text("order_number", "Order number", "订单号", "訂單號", true), text("customer_id", "Customer", "客户名称", "客戶名稱", true), text("project_engineer_id", "Project engineer", "项目工程师", "項目工程師"), text("chip_model", "Chip model", "芯片型号", "晶片型號", true), text("chip_number", "Chip number", "芯片编号", "晶片編號"), text("outsourced_order_number", "Outsourced order number", "外协单号", "外協單號"), text("project_name", "Project name", "方案名称", "方案名稱", true), date("evaluation_time", "Evaluation time", "评估时间", "評估時間"), number("yield_rate", "Yield rate", "良率"), number("decap_quantity", "DECAP quantity", "Deacp数量", true), select("has_polyimide", "Has polyimide", "芯片有ployimide（PI）", yesNo, "否", true), select("pi_removal_method", "PI removal method", "去PI手段", [option("化学手段", "Chemical"), option("FIB设备", "FIB equipment")]), select("package_type", "Package type", "芯片封装类型", [option("正装", "Wire-bonded"), option("倒装", "Flip-chip"), option("其他", "Other")], undefined, true), number("packaged_chip_count", "Packaged chip count", "封装中封了几个芯片", true), text("bond_wire_material", "Bond wire material", "绑定线材质", "綁定線材質", true), select("wire_separation_method", "Wire separation", "挑断绑定线", [option("手工挑线", "Manual"), option("设备切线", "Equipment")], undefined, true), text("process_node", "Process node", "芯片制程", "晶片製程", true), text("line_width", "Line width", "线宽", "線寬", true), number("metal_layer_count", "Metal layers", "金属层数", true), text("fib_modification_area", "FIB modification area", "FIB修改部分", "FIB修改部分", true), text("design_chip_scaling", "Design/chip scaling", "设计图跟芯片缩放", "設計圖跟晶片縮放", true), select("has_dummy", "Has dummy", "加工区域是否有dummy", [ ...yesNo ], undefined, true), text("wire_resistance_requirement", "Wire resistance requirement", "连线电阻要求", "連線電阻要求", true), text("sensitive_device_below_area", "Sensitive device below area", "加工区域下方敏感器件", "加工區域下方敏感器件", true), select("dispensing_type", "Dispensing", "是否点胶", [option("否", "No"), option("普通胶", "Normal glue"), option("高温胶", "High-temperature glue")], "否", true), number("dispensing_count", "Dispensing count", "点胶个数"), number("pcb_count", "PCB count", "PCB板个数"), number("copper_pillar_removal_count", "Copper pillar removal", "去铜柱个数"), number("solder_ball_removal_count", "Solder ball removal", "去锡球个数"), number("ball_planting_count", "Ball planting", "植球个数"), area("special_requirements", "Special requirements", "特别强调", "特別強調"), select("importance", "Importance", "重要程度", [option("一般", "Normal"), option("重要", "Important"), option("紧急", "Urgent")], "一般", true), number("fib_failure_count", "FIB failures", "FIB失败个数"), text("failure_numbers", "Failure numbers", "失败编号", "失敗編號"), area("test_result", "Test result", "测试结果", "測試結果"), select("customer_returns_failure_sample", "Failure sample returned", "客户是否返回失效样品", yesNo, "否", true)],
  },
  {
    key: "chip-retention", en: "Chip Retention", zhCN: "芯片留存", zhHK: "晶片留存",
    fields: [text("customer_id", "Customer", "客户名称", "客戶名稱", true), text("order_id", "Order", "订单号", "訂單號", true), text("chip_model", "Chip model", "芯片型号", "晶片型號", true), date("received_on", "Received on", "入库日期", "入庫日期", true), number("received_total", "Received total", "收到总数", true), number("used_this_time", "Used this time", "本次使用"), number("remaining_quantity", "Remaining quantity", "剩余数量", "剩餘數量", true), text("storage_location", "Storage location", "存放位置", "存放位置", true), date("last_updated_on", "Last updated", "最后更新日期", "最後更新日期", true)],
  },
  {
    key: "bill", en: "Bill", zhCN: "账单", zhHK: "帳單",
    fields: [text("bill_number", "Bill number", "账单号", "帳單號", true), text("customer_id", "Customer", "客户名称", "客戶名稱", true), text("settlement_cycle", "Settlement cycle", "结算周期", "結算週期", true), number("amount", "Amount", "账单金额", true), text("fee_number", "Fee number", "费用单号", "費用單號", true), date("billed_on", "Billed on", "开单日期", "開單日期", true), text("project_name", "Project name", "项目名称", "項目名稱", true), number("unit_price", "Unit price", "单价", "單價", true), number("time_or_quantity", "Time / quantity", "时间/数量", "時間/數量", true), number("subtotal", "Subtotal", "小计", "小計", true), number("received_amount", "Received amount", "实收金额", "實收金額", true), text("project_engineer_id", "Project engineer", "项目工程师", "項目工程師"), text("process_node", "Process node", "工艺制程", "工藝製程"), text("product_plan_name", "Product plan", "产品方案名", "產品方案名"), text("notes", "Notes", "备注", "備註"), select("send_status", "Send status", "发送状态", [option("未发送", "Not sent"), option("已发送", "Sent"), option("已确认", "Confirmed")], "未发送", true), date("reconciled_on", "Reconciled on", "对账日期", "對賬日期", true)],
  },
  {
    key: "payment-collection", en: "Payment Collection", zhCN: "回款", zhHK: "回款",
    fields: [text("bill_id", "Bill", "账单号", "帳單號", true), text("customer_id", "Customer", "客户简称", "客戶簡稱", true), date("reconciled_on", "Reconciled on", "对账日期", "對賬日期", true), number("bill_amount", "Bill amount", "账单金额", true), date("invoiced_on", "Invoiced on", "开票时间", "開票時間"), text("invoice_title", "Invoice title", "发票抬头", "發票抬頭", true), number("amount", "Payment amount", "回款金额", "回款金額", true), date("paid_on", "Paid on", "回款日期", "回款日期", true), text("bank", "Bank", "回款银行", "回款銀行", true), select("method", "Payment method", "回款方式", [option("银行汇款", "Bank transfer"), option("承兑", "Acceptance"), option("现金", "Cash"), option("预付款", "Prepayment")], "银行汇款", true), text("sales_owner_id", "Sales owner", "对应销售", "對應銷售", true), area("notes", "Notes", "备注", "備註"), select("overdue_status", "Overdue status", "逾期状态", [option("正常", "Normal"), option("黄色", "Yellow"), option("橙色", "Orange"), option("红色", "Red"), option("黑色", "Black")], "正常"), number("overdue_days", "Overdue days", "逾期天数", "逾期天數")],
  },
  {
    key: "outsourced-service", en: "Outsourced Service", zhCN: "外包服务", zhHK: "外包服務",
    fields: [text("processing_number", "Processing number", "加工单号", "加工單號", true), date("processed_on", "Processing date", "加工日期", "加工日期", true), text("customer_id", "Customer", "客户名称", "客戶名稱", true), text("project_engineer_id", "Project engineer", "项目工程师", "項目工程師"), text("assigner", "Assigner", "委托人", "委託人"), text("project_name", "Project name", "项目名称", "項目名稱", true), number("amount_including_tax", "Amount incl. tax", "金额(含税)", "金額(含稅", true), text("vendor", "Vendor", "外包厂商", "外包廠商", true), text("commissioning_number", "Commissioning number", "委托单号", "委託單號")],
  },
];

function localized(item: { en: string; zhCN: string; zhHK: string }, locale: Locale): string {
  return locale === "en" ? item.en : locale === "zh-HK" ? item.zhHK : item.zhCN;
}

function optionLabel(item: LocalizedOption, locale: Locale): string {
  return locale === "en" ? item.en : locale === "zh-HK" ? item.zhHK : item.zhCN;
}

type SalesEntityRow = Record<string, unknown> & { id: string };

function emptyEntityRow(template: SalesTemplate): SalesEntityRow {
  return Object.fromEntries([
    ["id", `draft-${crypto.randomUUID()}`],
    ...template.fields.map((field) => [field.key, field.defaultValue ?? ""]),
  ]) as SalesEntityRow;
}

function rowActionButton(label: string, icon: string, className: string, onClick: () => void) {
  return <button type="button" className={`grid-row-action ${className}`} aria-label={label} title={label} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onClick(); }}>
    <svg aria-hidden="true" viewBox="0 0 24 24"><path d={icon} /></svg>
  </button>;
}

function DynamicSalesEntityGrid({ locale, theme }: { locale: Locale; theme: ThemeMode }) {
  const [selectedKey, setSelectedKey] = useState(customerTemplates[0]!.key);
  const [editing, setEditing] = useState<{ mode: "create" | "edit"; record?: BusinessEntityRecord } | null>(null);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const [editError, setEditError] = useState("");
  const entitiesQuery = useGetBusinessEntitiesQuery(locale);
  const [createRecord, createState] = useCreateBusinessEntityRecordMutation();
  const [updateRecord, updateState] = useUpdateBusinessEntityRecordMutation();
  const [deleteRecord, deleteState] = useDeleteBusinessEntityRecordMutation();
  const detailGridApi = useRef<GridApi<Record<string, unknown>> | null>(null);
  const entities = entitiesQuery.data?.entities || [];
  const displayEntities = useMemo<BusinessEntityDescriptor[]>(() => entities.length > 0 ? entities : customerTemplates.map((template, index) => ({
    key: template.key,
    table_name: template.key.replaceAll("-", "_"),
    name: localized(template, locale),
    name_i18n: { en: template.en, zh_CN: template.zhCN, zh_HK: template.zhHK },
    display_order: index + 1,
    record_count: 0,
    columns: template.fields.map((field) => ({ key: field.key, data_type: field.widget === "number" ? "decimal" : field.widget === "date" ? "date" : field.widget === "select" ? "text" : "text", editable: true, required: Boolean(field.required) })),
    records: [],
  })), [entities, locale]);
  const selectedEntity: BusinessEntityDescriptor | undefined = displayEntities.find((entity) => entity.key === selectedKey) || displayEntities[0];
  const selected = customerTemplates.find((template) => template.key === selectedKey) || customerTemplates[0]!;
  const gridTheme = theme === "navy" ? orbitGridNavyTheme : theme === "light" ? orbitGridTheme : theme === "black" ? orbitGridBlackTheme : orbitGridGreenTheme;
  const detailRows = useMemo(() => (selectedEntity?.records || []).map((record) => ({ id: record.id, version: record.version, ...record.values })), [selectedEntity]);
  const editableColumns = useMemo(() => new Map((selectedEntity?.columns || []).map((column) => [column.key, column])), [selectedEntity]);

  function openCreate() {
    setEditError("");
    setEditValues(Object.fromEntries(selected.fields.map((field) => [field.key, field.defaultValue ?? field.options?.[0]?.value ?? (field.widget === "multiselect" ? [] : "")])));
    setEditing({ mode: "create" });
  }
  function openEdit(record: BusinessEntityRecord) {
    setEditError("");
    setEditValues({ ...record.values });
    setEditing({ mode: "edit", record });
  }
  function openDuplicate(record: BusinessEntityRecord) {
    setEditError("");
    setEditValues({ ...record.values });
    setEditing({ mode: "create" });
  }
  async function saveRecord() {
    const missing = selected.fields.find((field) => field.required && editableColumns.get(field.key)?.editable && String(editValues[field.key] ?? "").trim() === "");
    if (missing) { setEditError(locale === "en" ? `${localized(missing, locale)} is required.` : `${localized(missing, locale)}为必填项。`); return; }
    try {
      const values = Object.fromEntries(Object.entries(editValues).filter(([key]) => editableColumns.get(key)?.editable));
      if (editing?.mode === "edit" && editing.record) await updateRecord({ entityKey: selected.key, recordId: editing.record.id, version: editing.record.version, values }).unwrap();
      else await createRecord({ entityKey: selected.key, values }).unwrap();
      setEditing(null);
    } catch (error) { setEditError(typeof error === "object" && error && "data" in error ? String((error as { data?: unknown }).data) : "Could not save this record."); }
  }
  async function removeRecord(record: BusinessEntityRecord) {
    if (!window.confirm(locale === "en" ? "Delete this record?" : locale === "zh-HK" ? "刪除此記錄？" : "删除此记录？")) return;
    await deleteRecord({ entityKey: selected.key, recordId: record.id });
  }
  const detailColumns: ColDef<Record<string, unknown>>[] = [
    { headerName: "#", width: 65, pinned: "left", valueGetter: (params) => (params.node?.rowIndex ?? 0) + 1, editable: false, sortable: false, filter: false },
    ...selected.fields.map((field): ColDef<Record<string, unknown>> => ({ field: field.key, headerName: localized(field, locale), minWidth: field.widget === "textarea" ? 220 : 145, flex: 1, editable: false, valueFormatter: (params) => field.options?.find((item) => item.value === params.value) ? optionLabel(field.options.find((item) => item.value === params.value)!, locale) : String(params.value ?? "") })),
    { colId: "actions", headerName: locale === "en" ? "Actions" : locale === "zh-HK" ? "操作" : "操作", pinned: "right", width: 132, sortable: false, filter: false, editable: false, cellRenderer: (params: ICellRendererParams<Record<string, unknown>>) => {
      if (!params.data) return null;
      const record = selectedEntity?.records.find((item) => String(item.id) === String(params.data!.id)) || { id: String(params.data.id), version: Number(params.data.version || 1), updated_at: "", values: Object.fromEntries(Object.entries(params.data).filter(([key]) => key !== "id" && key !== "version")) };
      return <div className="grid-row-actions">{rowActionButton(locale === "en" ? "Edit row" : "编辑行", "m4 16-.8 4.8L8 20l10.8-10.8-4-4L4 16Zm9.4-9.4 4 4", "grid-row-action--edit", () => openEdit(record))}{rowActionButton(locale === "en" ? "Duplicate row" : "复制行", "M8 8h11v11H8zM5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1", "grid-row-action--duplicate", () => openDuplicate(record))}{rowActionButton(locale === "en" ? "Delete row" : "删除行", "M5 7h14M10 11v6m4-6v6M9 7V4h6v3m-9 0 1 13h8l1-13", "grid-row-action--delete", () => void removeRecord(record))}</div>;
    } },
  ];
  const gridProfileKey = `orbit:business-entities:grid:${selected.key}:${locale}:${theme}`;
  function saveGridProfile(api: GridApi<Record<string, unknown>>) {
    window.localStorage.setItem(gridProfileKey, JSON.stringify(api.getColumnState()));
  }
  function restoreGridProfile(api: GridApi<Record<string, unknown>>) {
    try {
      const raw = window.localStorage.getItem(gridProfileKey);
      if (raw) api.applyColumnState({ state: JSON.parse(raw), applyOrder: true });
    } catch { window.localStorage.removeItem(gridProfileKey); }
  }
  function resetGridProfile() {
    detailGridApi.current?.resetColumnState();
    window.localStorage.removeItem(gridProfileKey);
  }

  return <section className={`sales-templates sales-templates--${theme}`}>
    <header className="sales-templates__intro"><div><span className="system-config-kicker">{translate(locale, "templates")}</span><h2>{translate(locale, "salesTemplateFields")}</h2></div><p>{locale === "en" ? "Select an entity above, then manage its database records below. Each entity opens its own generated fields in the record dialog." : locale === "zh-HK" ? "先選取上方業務實體，再於下方管理資料庫記錄；每個實體會在記錄視窗中載入自己的欄位。" : "先选择上方业务实体，再在下方管理数据库记录；每个实体会在记录弹窗中加载自己的字段。"}</p></header>
    <div className="sales-templates__layout">
      <div className="sales-templates__master"><div className="sales-templates__section-label">{locale === "en" ? "1. Select business entity" : locale === "zh-HK" ? "1. 選取業務實體" : "1. 选择业务实体"}</div><div className="sales-templates__entity-panel" role="tablist">{displayEntities.map((entity) => <button key={entity.key} type="button" role="tab" aria-selected={entity.key === selectedKey} className="sales-templates__entity-card" onClick={() => setSelectedKey(entity.key)}><span className="sales-templates__entity-card-name">{entity.name}</span><span className="sales-templates__entity-card-meta">{entity.record_count} {translate(locale, "records")}</span></button>)}</div></div>
      <div className="sales-templates__fields" role="tabpanel">
        <div className="sales-templates__title"><div><span className="system-config-kicker">{selectedEntity?.table_name || selected.key}</span><h3>{selectedEntity?.name || localized(selected, locale)}</h3></div><span>{selectedEntity?.record_count ?? 0} {translate(locale, "records")} · {selected.fields.length} {translate(locale, "salesTemplateFields")}</span></div>
        {entitiesQuery.isError ? <p className="system-config-error" role="alert">{locale === "en" ? "Business entity data could not be loaded." : "业务实体数据加载失败。"}</p> : null}
        <div className="sales-templates__grid-toolbar"><div className="grid-toolbar"><button type="button" className="grid-add-button" aria-label={locale === "en" ? "Add record" : locale === "zh-HK" ? "新增記錄" : "新增记录"} title={locale === "en" ? "Add record" : locale === "zh-HK" ? "新增記錄" : "新增记录"} onClick={openCreate}><svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M12 5v14M5 12h14" /></svg></button><button type="button" className="grid-layout-reset-button" aria-label={locale === "en" ? "Reset grid layout" : "重置表格布局"} title={locale === "en" ? "Reset grid layout" : "重置表格布局"} onClick={resetGridProfile}>{locale === "en" ? "Reset layout" : locale === "zh-HK" ? "重置布局" : "重置布局"}</button></div><small>{selected.fields.length} {translate(locale, "salesTemplateFields")}</small></div>
        <div className="sales-templates__grid system-config-grid grid-frame" aria-busy={entitiesQuery.isLoading || deleteState.isLoading}><AgGridReact<Record<string, unknown>> key={`${selected.key}-${locale}-${theme}`} containerStyle={{ width: "100%", height: "100%" }} theme={gridTheme} rowData={detailRows} columnDefs={detailColumns} defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, suppressHeaderMenuButton: false }} getRowId={(params) => String(params.data.id)} rowHeight={44} headerHeight={46} floatingFiltersHeight={34} stopEditingWhenCellsLoseFocus enableBrowserTooltips ensureDomOrder suppressAnimationFrame sideBar={{ toolPanels: [{ id: "columns", labelDefault: "Columns", labelKey: "columns", iconKey: "columns", toolPanel: "agColumnsToolPanel", toolPanelParams: { suppressRowGroups: false, suppressValues: true, suppressPivots: true, suppressPivotMode: true } }], defaultToolPanel: "columns" }} rowGroupPanelShow="always" suppressHorizontalScroll={false} alwaysShowHorizontalScroll onGridReady={(event) => { detailGridApi.current = event.api; restoreGridProfile(event.api); }} onColumnMoved={(event) => saveGridProfile(event.api)} onColumnVisible={(event) => saveGridProfile(event.api)} onColumnPinned={(event) => saveGridProfile(event.api)} onColumnResized={(event) => { if (event.finished) saveGridProfile(event.api); }} onColumnRowGroupChanged={(event) => saveGridProfile(event.api)} overlayNoRowsTemplate={`<span class="grid-empty">${locale === "en" ? "No records yet — use + to add one" : locale === "zh-HK" ? "尚無記錄 — 使用 + 新增" : "暂无记录 — 使用 + 新增"}</span>`} /></div>
      </div>
    </div>
    {editing ? <div className="sales-template-modal__backdrop" role="presentation" onMouseDown={() => setEditing(null)}><div className="sales-template-modal" role="dialog" aria-modal="true" aria-labelledby="business-record-dialog-title" onMouseDown={(event) => event.stopPropagation()}><div className="sales-template-modal__header"><div><span className="system-config-kicker">{selectedEntity?.table_name}</span><h3 id="business-record-dialog-title">{editing.mode === "edit" ? (locale === "en" ? "Edit record" : "编辑记录") : (locale === "en" ? "Add record" : "新增记录")}</h3></div><button type="button" className="modal-close" onClick={() => setEditing(null)} aria-label="Close"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg></button></div><div className="sales-template-modal__body">{selected.fields.map((field) => { const column = editableColumns.get(field.key); const readOnly = !column || !column.editable; return <label key={field.key} className={`sales-template-field ${field.widget === "textarea" ? "sales-template-field--wide" : ""}`}><span>{localized(field, locale)}{field.required && !readOnly ? " *" : ""}</span>{field.widget === "select" ? <select value={String(editValues[field.key] ?? "")} disabled={readOnly} onChange={(event) => setEditValues((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">—</option>{field.options?.map((item) => <option key={item.value} value={item.value}>{optionLabel(item, locale)}</option>)}</select> : field.widget === "textarea" ? <textarea value={String(editValues[field.key] ?? "")} readOnly={readOnly} onChange={(event) => setEditValues((current) => ({ ...current, [field.key]: event.target.value }))} /> : <input type={field.widget === "number" ? "number" : field.widget === "date" ? "date" : "text"} value={String(editValues[field.key] ?? "")} readOnly={readOnly} onChange={(event) => setEditValues((current) => ({ ...current, [field.key]: event.target.value }))} />}</label>; })}</div>{editError ? <p className="system-config-error sales-template-modal__error" role="alert">{editError}</p> : null}<div className="sales-template-modal__footer"><button type="button" className="button button--secondary modal-action-button modal-action-button--cancel" onClick={() => setEditing(null)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>{locale === "en" ? "Cancel" : "取消"}</button><button type="button" className="button button--primary modal-action-button" disabled={createState.isLoading || updateState.isLoading} onClick={() => void saveRecord()}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>{createState.isLoading || updateState.isLoading ? "…" : locale === "en" ? "Save record" : "保存记录"}</button></div></div></div> : null}
  </section>;
}

export function SalesTemplatesPage(props: { locale: Locale; theme: ThemeMode }) {
  return <DynamicSalesEntityGrid {...props} />;
}

function LegacySalesTemplatesPage({ locale, theme }: { locale: Locale; theme: ThemeMode }) {
  const [selectedKey, setSelectedKey] = useState(customerTemplates[0]!.key);
  const [rowsByEntity, setRowsByEntity] = useState<Record<string, SalesEntityRow[]>>({});
  const [editingRow, setEditingRow] = useState<SalesEntityRow | null>(null);
  const [editingExisting, setEditingExisting] = useState(false);
  const [editError, setEditError] = useState("");
  const selected = customerTemplates.find((template) => template.key === selectedKey) || customerTemplates[0]!;
  const rows = rowsByEntity[selected.key] || [];
  const gridTheme = theme === "navy" ? orbitGridNavyTheme : theme === "light" ? orbitGridTheme : theme === "black" ? orbitGridBlackTheme : orbitGridGreenTheme;

  function updateRows(nextRows: SalesEntityRow[]) {
    setRowsByEntity((current) => ({ ...current, [selected.key]: nextRows }));
  }

  function openCreate() {
    setEditError("");
    setEditingExisting(false);
    setEditingRow(emptyEntityRow(selected));
  }

  function openEdit(row: SalesEntityRow) {
    setEditError("");
    setEditingExisting(true);
    setEditingRow({ ...row });
  }

  function openDuplicate(row: SalesEntityRow) {
    setEditError("");
    setEditingExisting(false);
    setEditingRow({ ...row, id: `draft-${crypto.randomUUID()}` });
  }

  function saveModal() {
    if (!editingRow) return;
    const missing = selected.fields.find((field) => field.required && String(editingRow[field.key] ?? "").trim() === "");
    if (missing) {
      setEditError(locale === "en" ? `${localized(missing, locale)} is required.` : `${localized(missing, locale)}为必填项。`);
      return;
    }
    if (editingExisting) {
      updateRows(rows.map((row) => row.id === editingRow.id ? editingRow : row));
    } else {
      updateRows([...rows, editingRow]);
    }
    setEditingRow(null);
  }

  const columns = useMemo<ColDef<SalesEntityRow>[]>(() => [
    { headerName: "#", width: 68, pinned: "left", valueGetter: (params) => (params.node?.rowIndex ?? 0) + 1, editable: false },
    ...selected.fields.map((field): ColDef<SalesEntityRow> => ({
      field: field.key,
      headerName: localized(field, locale),
      minWidth: field.widget === "textarea" ? 230 : 150,
      flex: 1,
      editable: true,
      cellEditor: field.widget === "select" ? "agSelectCellEditor" : undefined,
      cellEditorParams: field.widget === "select" ? { values: field.options?.map((item) => item.value) || [] } : undefined,
      valueFormatter: (params) => field.options?.find((item) => item.value === params.value) ? optionLabel(field.options.find((item) => item.value === params.value)!, locale) : String(params.value ?? ""),
    })),
    {
      colId: "actions",
      headerName: locale === "en" ? "Actions" : locale === "zh-HK" ? "操作" : "操作",
      width: 118,
      pinned: "right",
      sortable: false,
      filter: false,
      editable: false,
      cellRenderer: (params: ICellRendererParams<SalesEntityRow>) => params.data ? <div className="grid-row-actions">
        {rowActionButton(locale === "en" ? "Edit row" : "编辑行", "m4 16-.8 4.8L8 20l10.8-10.8-4-4L4 16Zm9.4-9.4 4 4", "grid-row-action--edit", () => openEdit(params.data!))}
        {rowActionButton(locale === "en" ? "Duplicate row" : "复制行", "M8 8h11v11H8zM5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1", "grid-row-action--duplicate", () => openDuplicate(params.data!))}
        {rowActionButton(locale === "en" ? "Delete row" : "删除行", "M5 7h14M10 11v6m4-6v6M9 7V4h6v3m-9 0 1 13h8l1-13", "grid-row-action--delete", () => updateRows(rows.filter((row) => row.id !== params.data!.id)))}
      </div> : null,
    },
  ], [locale, rows, selected.fields]);

  return <section className={`sales-templates sales-templates--${theme}`}>
    <header className="sales-templates__intro"><div><span className="system-config-kicker">{translate(locale, "templates")}</span><h2>{translate(locale, "salesTemplateFields")}</h2></div><p>{locale === "en" ? "Manage business entities in the same grid workflow as steps. Add and edit records through the entity-specific modal." : locale === "zh-HK" ? "以與工作流程步驟相同的表格方式管理業務實體，並透過實體專用視窗新增及編輯記錄。" : "使用与工作流步骤相同的表格方式管理业务实体，并通过实体专用弹窗新增和编辑记录。"}</p></header>
    <div className="sales-templates__layout">
      <nav className="sales-templates__entity-tabs system-config-tabs system-config-tabs--sub" aria-label={translate(locale, "templates")} role="tablist">
        {customerTemplates.map((template) => <button key={template.key} type="button" role="tab" aria-selected={selected.key === template.key} onClick={() => setSelectedKey(template.key)}>{localized(template, locale)}<small>{template.fields.length}</small></button>)}
      </nav>
      <div className="sales-templates__fields" role="tabpanel">
        <div className="sales-templates__title"><div><span className="system-config-kicker">{selected.key}</span><h3>{localized(selected, locale)}</h3></div><span>{rows.length} {translate(locale, "records")}</span></div>
        <div className="sales-templates__grid-toolbar"><button type="button" className="grid-add-button" onClick={openCreate}><span aria-hidden="true">+</span>{locale === "en" ? "Add record" : locale === "zh-HK" ? "新增記錄" : "新增记录"}</button><small>{selected.fields.length} {translate(locale, "salesTemplateFields")}</small></div>
        <div className="sales-templates__grid grid-frame"><AgGridReact<SalesEntityRow> theme={gridTheme} rowData={rows} columnDefs={columns} defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, suppressHeaderMenuButton: false }} rowHeight={44} headerHeight={46} floatingFiltersHeight={34} stopEditingWhenCellsLoseFocus enableBrowserTooltips ensureDomOrder onCellValueChanged={(event) => { if (!event.data) return; updateRows(rows.map((row) => row.id === event.data!.id ? { ...event.data! } : row)); }} /></div>
      </div>
    </div>
    {editingRow ? <div className="sales-template-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingRow(null); }}>
      <div className="sales-template-modal" role="dialog" aria-modal="true" aria-labelledby="sales-template-modal-title">
        <header><div><span className="system-config-kicker">{editingExisting ? (locale === "en" ? "Edit record" : locale === "zh-HK" ? "編輯記錄" : "编辑记录") : (locale === "en" ? "New record" : locale === "zh-HK" ? "新增記錄" : "新增记录")}</span><h3 id="sales-template-modal-title">{localized(selected, locale)}</h3></div><button type="button" className="sales-template-modal__close" onClick={() => setEditingRow(null)} aria-label={translate(locale, "cancel")}>×</button></header>
        <div className="sales-template-modal__fields">{selected.fields.map((field) => <label className="sales-template-field" key={field.key}><span>{localized(field, locale)} {field.required ? <em>*</em> : null}</span>{field.widget === "select" ? <select value={String(editingRow[field.key] ?? "")} onChange={(event) => setEditingRow({ ...editingRow, [field.key]: event.target.value })}><option value="">{translate(locale, "templateSelect")}</option>{field.options?.map((item) => <option key={item.value} value={item.value}>{optionLabel(item, locale)}</option>)}</select> : field.widget === "textarea" ? <textarea rows={3} value={String(editingRow[field.key] ?? "")} onChange={(event) => setEditingRow({ ...editingRow, [field.key]: event.target.value })} /> : <input type={field.widget} value={String(editingRow[field.key] ?? "")} onChange={(event) => setEditingRow({ ...editingRow, [field.key]: field.widget === "number" ? event.target.value : event.target.value })} />}</label>)}</div>
        {editError && <p className="sales-template-modal__error" role="alert">{editError}</p>}
        <footer><button type="button" className="system-config-back" onClick={() => setEditingRow(null)}>{translate(locale, "cancel")}</button><button type="button" className="grid-add-button sales-template-modal__save" onClick={saveModal}>{translate(locale, "save")}</button></footer>
      </div>
    </div> : null}
  </section>;
}
