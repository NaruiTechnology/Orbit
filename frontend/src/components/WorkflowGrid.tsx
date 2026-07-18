import {
  themeQuartz,
  type CellClickedEvent,
  type CellFocusedEvent,
  type CellValueChangedEvent,
  type ColDef,
  type ColGroupDef,
  type GridApi,
  type GridReadyEvent,
  type IDatasource,
  type IGetRowsParams,
  type ICellRendererParams,
  type SortChangedEvent,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ColumnDefinition,
  Locale,
  ThemeMode,
  WorkflowDetail,
  WorkflowRecord,
} from "../types";
import { translate } from "../i18n/translations";


const orbitGridTheme = themeQuartz.withParams({
  accentColor: "#1f6fc2",
  backgroundColor: "#ffffff",
  foregroundColor: "#1a2233",
  borderColor: "#cdd5e0",
  headerBackgroundColor: "#1f5fa0",
  headerTextColor: "#ffffff",
  oddRowBackgroundColor: "#f4f7fb",
  rowHoverColor: "#e2eaf3",
  selectedRowBackgroundColor: "#dbeafe",
  fontFamily: "IBM Plex Sans, Noto Sans SC, Noto Sans TC, sans-serif",
  fontSize: 13,
  spacing: 6,
  borderRadius: 0,
  wrapperBorderRadius: 0,
});

const orbitGridDarkTheme = themeQuartz.withParams({
  accentColor: "#f06a3b",
  backgroundColor: "#101814",
  foregroundColor: "#ecf4ef",
  borderColor: "#31423c",
  headerBackgroundColor: "#182420",
  headerTextColor: "#f8fbf7",
  oddRowBackgroundColor: "#13211c",
  rowHoverColor: "#21332c",
  selectedRowBackgroundColor: "#244137",
  fontFamily: "IBM Plex Sans, Noto Sans SC, Noto Sans TC, sans-serif",
  fontSize: 13,
  spacing: 6,
  borderRadius: 0,
  wrapperBorderRadius: 0,
});

interface WorkflowGridProps {
  locale: Locale;
  theme: ThemeMode;
  workflow: WorkflowDetail | undefined;
  dirtyRecordIds: string[];
  loading: boolean;
  search: string;
  onCellSelect: (recordId: string, cellKey: string | null) => void;
  onRecordUpdate: (
    record: WorkflowRecord,
    key: string,
    value: unknown,
  ) => Promise<WorkflowRecord>;
  onRecordAdd: () => Promise<WorkflowRecord>;
  onRecordDelete: (record: WorkflowRecord) => Promise<void>;
  onRecordFinishEdit: (recordId: string) => void;
  onSortChange: (sortBy: string, direction: "asc" | "desc") => void;
}

function widthFor(column: ColumnDefinition): number {
  if (["stage_number", "step_number", "sequence_number"].includes(column.key)) {
    return 90;
  }
  if (column.data_type === "boolean") {
    return 110;
  }
  if (["notes", "system_action", "exception_branch", "guidance"].includes(column.key)) {
    return 300;
  }
  return 170;
}

function displayValue(value: unknown, locale: Locale): string {
  if (typeof value === "boolean") {
    return value
      ? locale === "en" ? "Yes" : "是"
      : locale === "en" ? "No" : "否";
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function columnGroupKey(key: string): "workflow" | "business" | "context" {
  if (/(stage|step|sequence|status|state|phase|role|owner|time_limit)/i.test(key)) {
    return "workflow";
  }
  if (/(customer|order|business|laboratory|department|organization|employee|equipment|product)/i.test(key)) {
    return "business";
  }
  return "context";
}

interface RowActionRendererProps {
  data: WorkflowRecord | undefined;
  canEdit: boolean;
  locale: Locale;
  editing: boolean;
  onEdit: (record: WorkflowRecord) => void;
  onFinishEdit: () => void;
  onDelete: (record: WorkflowRecord) => Promise<void>;
}

function RowActionRenderer({
  data,
  canEdit,
  locale,
  editing,
  onEdit,
  onFinishEdit,
  onDelete,
}: RowActionRendererProps) {
  return (
    <div className="grid-row-actions">
      <button
        type="button"
        className={`grid-row-action ${editing ? "grid-row-action--update" : "grid-row-action--edit"}`}
        aria-label={editing ? "Save row" : "Edit row"}
        title={editing ? "Save row" : "Edit row"}
        disabled={!canEdit}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (data) {
            if (editing) onFinishEdit();
            else onEdit(data);
          }
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          {editing ? <path d="M5 4h12l2 2v14H5zM8 4v6h8V4M8 20v-6h8v6" /> : <path d="m4 16-.8 4.8L8 20l10.8-10.8-4-4L4 16Zm9.4-9.4 4 4" />}
        </svg>
      </button>
      <button
        type="button"
        className="grid-row-action grid-row-action--delete"
        aria-label={locale === "en" ? "Delete row" : "删除行"}
        title={locale === "en" ? "Delete row" : "删除行"}
        disabled={!canEdit}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (data) void onDelete(data);
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          <path d="M5 7h14M10 11v6m4-6v6M9 7V4h6v3m-9 0 1 13h8l1-13" />
        </svg>
      </button>
    </div>
  );
}

export function WorkflowGrid({
  locale,
  theme,
  workflow,
  dirtyRecordIds,
  loading,
  search,
  onCellSelect,
  onRecordUpdate,
  onRecordAdd,
  onRecordDelete,
  onRecordFinishEdit,
  onSortChange,
}: WorkflowGridProps) {
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const gridApi = useRef<GridApi<WorkflowRecord> | null>(null);

  useEffect(() => {
    gridApi.current?.refreshCells({ columns: ["actions"], force: true });
  }, [editingRowId]);
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
    usage: "sort",
  });
  const dynamicColumns: ColDef<WorkflowRecord>[] = (workflow?.columns || []).map(
    (column) => ({
      colId: column.key,
      headerName: column.label,
      width: widthFor(column),
      minWidth: 90,
      editable: (parameters) => Boolean(
        workflow?.access.can_edit &&
        column.editable &&
        parameters.data?.id === editingRowId,
      ),
      valueGetter: (parameters) => parameters.data?.values[column.key] ?? null,
      valueSetter: (parameters) => {
        if (!parameters.data) return false;
        parameters.data.values[column.key] = parameters.newValue;
        return true;
      },
      valueFormatter: (parameters) => displayValue(parameters.value, locale),
      comparator: (left, right) => collator.compare(displayValue(left, locale), displayValue(right, locale)),
      tooltipValueGetter: (parameters) => displayValue(parameters.value, locale),
      cellClassRules: {
        "grid-cell--multiline": () =>
          ["notes", "system_action", "exception_branch", "guidance"].includes(column.key),
        "grid-cell--alert": (parameters) =>
          column.key === "alert_level" && String(parameters.value).includes("红"),
      },
    }),
  );
  const groupedColumns = new Map<ReturnType<typeof columnGroupKey>, ColDef<WorkflowRecord>[]>();
  for (const column of dynamicColumns) {
    const group = columnGroupKey(String(column.colId || ""));
    const columns = groupedColumns.get(group) || [];
    columns.push(column);
    groupedColumns.set(group, columns);
  }
  const groupLabels = {
    workflow: locale === "en" ? "Workflow" : "工作流",
    business: locale === "en" ? "Business data" : "业务数据",
    context: locale === "en" ? "Context and details" : "上下文与详细信息",
  };
  const columnDefinitions: (ColDef<WorkflowRecord> | ColGroupDef<WorkflowRecord>)[] = [
    {
      colId: "record_order",
      field: "record_order",
      headerName: "#",
      pinned: "left",
      lockPinned: true,
      width: 64,
      minWidth: 64,
      maxWidth: 64,
      editable: false,
      cellClass: "grid-cell--sequence",
    },
    ...(["business", "workflow", "context"] as const)
      .filter((group) => groupedColumns.has(group))
      .map((group) => ({
        groupId: "orbit-" + group,
        headerName: groupLabels[group],
        marryChildren: true,
        children: groupedColumns.get(group) || [],
      })),
    {
      colId: "actions",
      headerName: locale === "en" ? "Actions" : "操作",
      pinned: "right",
      width: 76,
      minWidth: 76,
      maxWidth: 76,
      sortable: false,
      filter: false,
      editable: false,
      cellRenderer: (parameters: ICellRendererParams<WorkflowRecord>) => (
        <RowActionRenderer
          data={parameters.data}
          canEdit={Boolean(workflow?.access.can_edit)}
          locale={locale}
          editing={Boolean(
            parameters.data &&
            (parameters.data.id === editingRowId || dirtyRecordIds.includes(parameters.data.id)),
          )}
          onEdit={(record) => {
            setEditingRowId(record.id);
            const firstEditable = workflow?.columns.find((column) => column.editable);
            if (firstEditable) {
              window.setTimeout(() => {
                gridApi.current?.startEditingCell({
                  rowIndex: record.record_order - 1,
                  colKey: firstEditable.key,
                });
              }, 0);
            }
          }}
          onFinishEdit={() => {
            gridApi.current?.stopEditing();
            setEditingRowId(null);
            if (parameters.data) onRecordFinishEdit(parameters.data.id);
          }}
          onDelete={onRecordDelete}
        />
      ),
    },
  ];
  const datasource = useMemo<IDatasource>(() => ({
    getRows: (parameters: IGetRowsParams<WorkflowRecord>) => {
      if (!workflow?.key) {
        parameters.successCallback([], 0);
        return;
      }
      const sort = parameters.sortModel?.[0];
      const filterTerms = Object.values(parameters.filterModel || {})
        .map((filter) => {
          if (!filter || typeof filter !== "object") return "";
          const value = "filter" in filter ? filter.filter : "";
          return typeof value === "string" ? value : "";
        })
        .filter(Boolean);
      const query = new URLSearchParams({
        locale,
        offset: String(parameters.startRow),
        limit: String(parameters.endRow - parameters.startRow),
        sort_by: sort?.colId || "record_order",
        sort_direction: sort?.sort === "desc" ? "desc" : "asc",
      });
      const combinedSearch = [search, ...filterTerms].filter(Boolean).join(" ");
      if (combinedSearch) query.set("search", combinedSearch);
      const token = localStorage.getItem("orbit:auth-token");
      const requestInit: RequestInit = token
        ? { headers: { "X-Orbit-Auth": token } }
        : {};
      void fetch("/api/v1/workflows/" + encodeURIComponent(workflow.key) + "/records?" + query, requestInit)
        .then(async (response) => {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json() as Promise<{ items: WorkflowRecord[]; total: number }>;
        })
        .then((page) => parameters.successCallback(page.items, page.total))
        .catch(() => parameters.failCallback());
    },
  }), [locale, search, workflow?.key]);

  function handleCellFocused(event: CellFocusedEvent<WorkflowRecord>) {
    if (event.rowIndex === null) return;
    const row = event.api.getDisplayedRowAtIndex(event.rowIndex)?.data;
    const cellKey =
      typeof event.column === "string"
        ? event.column
        : event.column?.getColId() || null;
    if (cellKey === "actions") return;
    if (row) onCellSelect(row.tree_record_id || row.id, cellKey);
  }

  function handleCellClicked(event: CellClickedEvent<WorkflowRecord>) {
    if (event.colDef.colId !== "actions" || !event.data) return;
    const target = event.event?.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest(".grid-row-action--edit")) return;
    if (!target.closest(".grid-row-action--delete")) return;
    event.event?.stopPropagation();
    void onRecordDelete(event.data);
  }

  async function handleCellChanged(event: CellValueChangedEvent<WorkflowRecord>) {
    const record = event.data;
    const key = event.colDef.colId;
    if (!record || !key || key === "record_order" || key === "actions" || event.newValue === event.oldValue) {
      return;
    }
    setEditingRowId(record.id);
    try {
      const updated = await onRecordUpdate(record, key, event.newValue);
      event.node.setData({ ...updated, values: { ...updated.values } });
    } catch {
      event.node.setData({
        ...record,
        values: { ...record.values, [key]: event.oldValue },
      });
    }
  }

  function handleSortChanged(event: SortChangedEvent<WorkflowRecord>) {
    const sorted = event.api.getColumnState().find((column) => column.sort);
    onSortChange(
      sorted?.colId || "record_order",
      sorted?.sort === "desc" ? "desc" : "asc",
    );
  }

  return (
    <div className="grid-frame" aria-busy={loading}>
      <div className="grid-toolbar">
        <button
          className="grid-add-button"
          type="button"
          aria-label={locale === "en" ? "Add row" : "新增行"}
          title={locale === "en" ? "Add row" : "新增行"}
          disabled={!workflow?.access.can_edit || loading}
          onClick={() => void onRecordAdd()}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      <AgGridReact<WorkflowRecord>
        key={`${workflow?.key || "grid"}-${locale}-${theme}`}
        containerStyle={{ width: "100%", height: "100%" }}
        theme={theme === "dark" ? orbitGridDarkTheme : orbitGridTheme}
        rowModelType="infinite"
        datasource={datasource}
        cacheBlockSize={100}
        maxBlocksInCache={8}
        infiniteInitialRowCount={100}
        columnDefs={columnDefinitions}
        defaultColDef={{
          sortable: true,
          filter: true,
          floatingFilter: true,
          resizable: true,
          suppressHeaderMenuButton: false,
        }}
        getRowId={(parameters) => parameters.data.id}
        rowClassRules={{
          "grid-row--dirty": (parameters) =>
            Boolean(parameters.data && dirtyRecordIds.includes(parameters.data.id)),
        }}
        rowSelection={{
          mode: "singleRow",
          checkboxes: false,
          enableClickSelection: true,
        }}
        editType="fullRow"
        rowHeight={44}
        headerHeight={46}
        floatingFiltersHeight={34}
        suppressAnimationFrame
        suppressRowTransform
        enableBrowserTooltips
        ensureDomOrder
        onCellFocused={handleCellFocused}
        onCellClicked={handleCellClicked}
        onGridReady={(event: GridReadyEvent<WorkflowRecord>) => {
          gridApi.current = event.api;
        }}
        onCellValueChanged={handleCellChanged}
        onSortChanged={handleSortChanged}
        overlayNoRowsTemplate={`<span class="grid-empty">${translate(locale, "noData")}</span>`}
      />
      {loading ? (
        <div className="grid-loading" role="status" aria-label="Loading data">
          <span className="grid-loading__spinner" aria-hidden="true" />
        </div>
      ) : null}
    </div>
  );
}
