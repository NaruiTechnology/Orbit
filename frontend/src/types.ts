export type Locale = "en" | "zh-CN" | "zh-HK";
export type ThemeMode = "navy" | "light" | "green" | "black";

/** Numeric notification-template identifiers from the ManagementV2 workbook. */
export enum notifyType {
  customerFollowUpWarning = 1,
  quotationExpiryReminder = 2,
  contractExpiryReminder = 3,
  statementOverdueReminder = 4,
  statementOverdueIntervention = 5,
  invoiceOverdueReminder = 6,
  invoiceOverdueIntervention = 7,
  paymentDueReminder = 8,
  paymentMildOverdue = 9,
  paymentModerateOverdue = 10,
  paymentSevereOverdue = 11,
  customerPoolWarning = 12,
  customerPoolReclaimed = 13,
  feeConfirmationSent = 14,
  statementSent = 15,
  automaticFollowUp = 16,
  insufficientBalanceReminder = 17,
  technicalEvaluationTimeout = 18,
  sampleReturnTimeoutWarning = 19,
  sampleReturnTimeoutAlert = 20,
  failureAnalysisPending = 21,
  equipmentMaintenanceReminder = 22,
  equipmentRepairAlert = 23,
  yieldThresholdWarning = 24,
  customerTestResult = 25,
  analysisReportCompleted = 26,
  faultTicketSubmitted = 27,
  faultTicketUnclaimedTimeout = 28,
  repairAcceptance = 29,
  recoveryTimeUnavailable = 30,
  consumablesInventoryWarning = 31,
  consumablesDepleted = 32,
  repairBlocked = 33,
  equipmentIdleRateWeekly = 34,
  repairDurationMonthly = 35,
  remoteOrderTechnical = 36,
  remoteEvaluationResult = 37,
  remoteOrderAccepted = 38,
  remoteSampleShipped = 39,
  remoteOrderReturned = 40,
  remoteLogisticsException = 41,
  creditNoteSubmitted = 42,
  creditNoteApproved = 43,
  creditNoteRejected = 44,
  invoiceLaboratoryRedirect = 45,
  prepaidBalanceReminder = 46,
  prepaidBalanceDepleted = 47,
  paymentHoursFeedback = 48,
  prepaidRechargeConfirmed = 49,
  creditNoteCompleted = 50,
  faultTicketSubmittedDuplicate = 51,
  recoveryTimeUnavailableDuplicate = 52,
  repairAcceptanceDuplicate = 53,
}

export interface GeolocationSite {
  id: string;
  value: string;
  name: string;
  name_zh: string;
  label_key: string;
}

export interface GeolocationCatalog {
  version: number;
  default_site: string;
  sites: GeolocationSite[];
  legacy_aliases: Record<string, string>;
}

export interface ScopeInfo {
  organization_id: string;
  organization_name: string;
  department_id: string | null;
  department_name: string | null;
  laboratory_id: string | null;
  laboratory_name: string | null;
}

export interface SessionInfo {
  user_id: string;
  login_name: string;
  display_name: string;
  preferred_locale: string;
  roles: string[];
  permissions: string[];
  scope: ScopeInfo;
}

export interface WorkflowAccess {
  can_view: boolean;
  can_edit: boolean;
  can_execute: boolean;
}

export interface WorkflowSummary {
  id: string;
  key: string;
  parent_key: string | null;
  name: string;
  name_i18n: Record<string, string>;
  group_key: string;
  group_name: string;
  group_name_i18n: Record<string, string>;
  definition_type: string;
  is_master: boolean;
  display_order: number;
  record_count: number;
  access: WorkflowAccess;
}

export interface ColumnDefinition {
  key: string;
  source_label: string;
  label: string;
  label_i18n: Record<string, string>;
  data_type: "text" | "integer" | "decimal" | "boolean" | "date";
  editable: boolean;
  source_cell: string;
}

export interface WorkflowDetail extends WorkflowSummary {
  source_sheet: string;
  source_sheet_index: number;
  columns: ColumnDefinition[];
  metadata: Record<string, unknown>;
  catalog_version: number;
}

export interface WorkflowRecord {
  id: string;
  tree_record_id?: string | null;
  record_key: string;
  record_order: number;
  label: string;
  label_i18n: Record<string, string>;
  values: Record<string, unknown>;
  source_row: number | null;
  source_cells: Record<string, string>;
  version: number;
  updated_at: string;
}

export interface RecordPage {
  items: WorkflowRecord[];
  total: number;
  offset: number;
  limit: number;
  sort_by: string;
  sort_direction: "asc" | "desc";
}

export interface RecordCreate {
  workflowKey: string;
  values: Record<string, unknown>;
  locale: Locale;
}

export interface TreeNode {
  record_id: string;
  record_key: string;
  order: number;
  label: string;
  owner_role: string | null;
  owner_name: string | null;
  time_limit: string | null;
  ContactName: string | null;
  Email: string | null;
  Messages: string[];
  business_entity: string | null;
  DocumentAction: boolean | null;
  decisionAction: boolean;
  notifyAction: boolean | null;
  notifyType: notifyType | null;
  notifiedDate: string | null;
  sla: string | null;
  is_selected: boolean;
  is_before_selected: boolean;
}

export interface ReportTemplateSaveResponse {
  record_id: string;
  DocumentAction: true;
  download_url: string;
  content_type: string;
}

export interface TreeEdge {
  source: string;
  target: string;
  kind: string;
  label: string | null;
}

export interface WorkflowTree {
  workflow_key: string;
  workflow_name: string;
  selected_record_id: string | null;
  selected_cell_key: string | null;
  selected_cell_value: unknown;
  nodes: TreeNode[];
  edges: TreeEdge[];
}

export interface WorkflowDecisionStep {
  record_key: string;
  label: string;
}

export interface WorkflowDecisionCatalog {
  key: string;
  name: string;
  steps: WorkflowDecisionStep[];
}

export type WorkflowNodeStatus =
  | "pending" | "active" | "waiting" | "completed"
  | "failed" | "blocked" | "cancelled" | "skipped";

export interface WorkflowInstance {
  id: string;
  workflow_key: string;
  catalog_version: number;
  business_key: string;
  current_record_key: string | null;
  status: string;
  context: Record<string, unknown>;
  version: number;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface WorkflowNodeRuntime {
  record_key: string;
  status: WorkflowNodeStatus;
  completion_source: "system" | "user" | null;
  assigned_role: string | null;
  assigned_user_id: string | null;
  attempt_count: number;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  start_time: string | null;
  complete_time: string | null;
  action_time: string | null;
  action_type: "notification_email" | "system_task" | "workflow_transition" | "manual_action" | null;
  sla_violated: boolean;
  version: number;
  available_actions: string[];
}

export interface WorkflowRuntimeProjection {
  instance: WorkflowInstance;
  nodes: WorkflowNodeRuntime[];
}

export interface WorkflowCommandInput {
  command: string;
  nodeKey?: string;
  payload?: Record<string, unknown>;
  reason?: string;
  version: number;
}

export interface HealthResponse {
  status: "ok";
  application: string;
  is_production: boolean;
  database: string;
  server_encoding: string;
  client_encoding: string;
  timezone: string;
  workflow_count: number;
  record_count: number;
}
