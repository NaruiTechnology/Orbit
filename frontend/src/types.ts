export type Locale = "en" | "zh-CN" | "zh-HK";
export type ThemeMode = "light" | "dark";

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

export interface TreeNode {
  record_id: string;
  record_key: string;
  order: number;
  label: string;
  owner_role: string | null;
  time_limit: string | null;
  is_selected: boolean;
  is_before_selected: boolean;
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

export interface HealthResponse {
  status: "ok";
  application: string;
  database: string;
  server_encoding: string;
  client_encoding: string;
  timezone: string;
  workflow_count: number;
  record_count: number;
}
