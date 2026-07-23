/** Business records derived from 销售-导入表初版-可编辑版.xlsx. */

export type YesNo = "是" | "否";
export type ContractReviewStatus = "待审核" | "已审核";
export type ContractFulfillmentStatus = "执行中" | "已完结" | "终止";
export type BillSendStatus = "未发送" | "已发送" | "已确认";
export type PaymentMethod = "银行汇款" | "承兑" | "现金" | "预付款";
export type PaymentOverdueStatus = "正常" | "黄色" | "橙色" | "红色" | "黑色";

export interface SalesEntityBase {
  id: string;
  organization_id: string | null;
  department_id: string | null;
  laboratory_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface CustomerContact {
  id: string;
  customer_id: string;
  name: string;
  department: string | null;
  title: string | null;
  is_key_decision_maker: YesNo;
  phone: string;
  email: string | null;
}

export interface CustomerProfile extends SalesEntityBase {
  short_name: string;
  customer_code: string;
  website: string | null;
  primary_contact_name: string;
  landline: string | null;
  primary_mobile: string;
  primary_email: string | null;
  chip_application_category: string;
  source: string;
  stage: "新客户开发" | "老客户流失挽回";
  status: "未成交" | "已成交";
  lock_status: "未锁定" | "已锁定";
  level: "一级" | "二级" | "三级";
  competitors: string[];
  investor: string | null;
  core_team_background: string | null;
  laboratory_id: string;
  sales_owner_id: string;
  public_pool_countdown_days: number | null;
  contacts: CustomerContact[];
}

export interface BillingInformation extends SalesEntityBase {
  customer_id: string;
  invoice_title: string;
  tax_number: string;
  business_license_attachment_id: string;
  address: string;
  invoice_laboratory: string;
  invoice_type: "增值税普通发票-电子" | "增值税专用发票-电子";
  tax_rate: "1%" | "3%" | "6%" | "9%" | "13%";
  invoice_item: string;
  settlement_method: "月结" | "季度结" | "半年度结" | "充值扣款结算";
  invoice_format: "PDF" | "OFD" | "XML";
  finance_contact: string;
  finance_phone: string;
  reconciliation_email: string;
}

export interface Quotation extends SalesEntityBase {
  quotation_number: string;
  customer_id: string | null;
  valid_until: string;
  decap_count: number | null;
  fib_hours: number;
  fib_normal_glue_hours: number;
  fib_high_temperature_glue_hours: number;
  manual_wire_pick_hours: number;
  equipment_wire_cut_hours: number;
  equipment_pi_removal_hours: number;
  solder_ball_removal_count: number;
  copper_pillar_removal_count: number;
  ball_planting_count: number;
  pcb_mounting_fee_count: number;
  chemical_pi_removal_count: number;
  au_bond_wire_count: number;
  cu_bond_wire_count: number;
  alloy_al_special_bond_wire_count: number;
  om_photo_count: number;
  cross_section_analysis_count: number;
  has_discount: YesNo;
  discount_details: string;
  outsourced_project_count: number;
}

export interface Contract extends SalesEntityBase {
  name: string;
  contract_number: string;
  amount: number;
  signed_on: string;
  starts_on: string;
  ends_on: string;
  signing_company: string;
  review_status: ContractReviewStatus;
  signing_contact: string;
  owner: string;
  notes: string | null;
  attachment_id: string;
  contract_type: "技术服务合同" | "销售合同" | "保密合同" | "其他";
  fulfillment_status: ContractFulfillmentStatus;
  customer_id: string | null;
}

export interface SalesOrder extends SalesEntityBase {
  order_number: string;
  customer_id: string;
  project_engineer_id: string | null;
  chip_model: string;
  chip_number: string | null;
  outsourced_order_number: string | null;
  project_name: string;
  evaluation_time: string | null;
  yield_rate: number | null;
  decap_quantity: number;
  has_polyimide: YesNo;
  pi_removal_method: "化学手段" | "FIB设备" | null;
  package_type: "正装" | "倒装" | "其他";
  packaged_chip_count: number;
  bond_wire_material: string;
  wire_separation_method: "手工挑线" | "设备切线";
  process_node: string;
  line_width: string;
  metal_layer_count: number;
  fib_modification_area: string;
  design_chip_scaling: string;
  has_dummy: YesNo;
  wire_resistance_requirement: string;
  sensitive_device_below_area: string;
  dispensing_type: "否" | "普通胶" | "高温胶";
  dispensing_count: number;
  pcb_count: number;
  copper_pillar_removal_count: number;
  solder_ball_removal_count: number;
  ball_planting_count: number;
  special_requirements: string | null;
  importance: "一般" | "重要" | "紧急";
  fib_failure_count: number;
  failure_numbers: string | null;
  test_result: string | null;
  customer_returns_failure_sample: YesNo;
}

export interface ChipRetention extends SalesEntityBase {
  customer_id: string;
  order_id: string;
  chip_model: string;
  received_on: string;
  received_total: number;
  used_this_time: number;
  remaining_quantity: number;
  storage_location: string;
  last_updated_on: string;
}

/** Bill is the first table in 对账; the export template is intentionally omitted. */
export interface Bill extends SalesEntityBase {
  bill_number: string;
  customer_id: string;
  settlement_cycle: string;
  amount: number;
  fee_number: string;
  billed_on: string;
  project_name: string;
  unit_price: number;
  time_or_quantity: number;
  subtotal: number;
  received_amount: number;
  project_engineer_id: string | null;
  process_node: string | null;
  product_plan_name: string | null;
  notes: string | null;
  send_status: BillSendStatus;
  reconciled_on: string;
}

export interface PaymentCollection extends SalesEntityBase {
  bill_id: string;
  customer_id: string;
  reconciled_on: string;
  bill_amount: number;
  invoiced_on: string | null;
  invoice_title: string;
  amount: number;
  paid_on: string;
  bank: string;
  method: PaymentMethod;
  sales_owner_id: string;
  notes: string | null;
  overdue_status: PaymentOverdueStatus;
  overdue_days: number;
}

export interface OutsourcedService extends SalesEntityBase {
  processing_number: string;
  processed_on: string;
  customer_id: string;
  project_engineer_id: string | null;
  assigner: string | null;
  project_name: string;
  amount_including_tax: number;
  vendor: string;
  commissioning_number: string | null;
}

export interface SalesTables {
  customer_profiles: CustomerProfile;
  billing_information: BillingInformation;
  quotations: Quotation;
  contracts: Contract;
  sales_orders: SalesOrder;
  chip_retentions: ChipRetention;
  bills: Bill;
  payment_collections: PaymentCollection;
  outsourced_services: OutsourcedService;
}

export interface BusinessEntityColumn {
  key: string;
  data_type: "text" | "integer" | "decimal" | "boolean" | "date";
  editable: boolean;
  required: boolean;
}

export interface BusinessEntityRecord {
  id: string;
  values: Record<string, unknown>;
  version: number;
  updated_at: string;
}

export interface BusinessEntityDescriptor {
  key: string;
  table_name: string;
  name: string;
  name_i18n: Record<string, string>;
  display_order: number;
  record_count: number;
  columns: BusinessEntityColumn[];
  records: BusinessEntityRecord[];
}

export interface BusinessEntityResponse {
  entities: BusinessEntityDescriptor[];
}
