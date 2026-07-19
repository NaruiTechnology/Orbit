import {
  themeQuartz,
  type ColumnState,
  type CellClickedEvent,
  type CellFocusedEvent,
  type CellValueChangedEvent,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type IDatasource,
  type IGetRowsParams,
  type ICellRendererParams,
  type SortChangedEvent,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-enterprise";
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

const orbitGridGreenTheme = themeQuartz.withParams({
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

const orbitGridBlackTheme = themeQuartz.withParams({
  accentColor: "#ff7043",
  backgroundColor: "#0b0c0f",
  foregroundColor: "#f1f2f4",
  borderColor: "#363a44",
  headerBackgroundColor: "#20242b",
  headerTextColor: "#ffffff",
  oddRowBackgroundColor: "#15171c",
  rowHoverColor: "#252a33",
  selectedRowBackgroundColor: "#303640",
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
  profileKey: string | null;
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

interface RowActionRendererProps {
  data: WorkflowRecord | undefined;
  canEdit: boolean;
  locale: Locale;
  editing: boolean;
  onEdit: (record: WorkflowRecord) => void;
  onFinishEdit: () => Promise<void>;
  onCancelEdit: () => void;
  onDelete: (record: WorkflowRecord) => Promise<void>;
}

function RowActionRenderer({
  data,
  canEdit,
  locale,
  editing,
  onEdit,
  onFinishEdit,
  onCancelEdit,
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
      {editing ? (
        <button
          type="button"
          className="grid-row-action grid-row-action--cancel"
          aria-label={locale === "en" ? "Cancel edit" : "取消编辑"}
          title={locale === "en" ? "Cancel edit" : "取消编辑"}
          disabled={!canEdit}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onCancelEdit();
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      ) : null}
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
  profileKey,
}: WorkflowGridProps) {
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const gridApi = useRef<GridApi<WorkflowRecord> | null>(null);
  const originalValues = useRef<Map<string, Record<string, unknown>>>(new Map());
  const pendingValues = useRef<Map<string, Record<string, unknown>>>(new Map());

  useEffect(() => {
    gridApi.current?.refreshCells({ columns: ["actions"], force: true });
  }, [editingRowId]);

  function cloneValues(values: Record<string, unknown>): Record<string, unknown> {
    return { ...values };
  }

  function beginEditing(record: WorkflowRecord) {
    originalValues.current.set(record.id, cloneValues(record.values));
    pendingValues.current.set(record.id, {});
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
  }

  async function finishEditing(record: WorkflowRecord): Promise<void> {
    const changes = pendingValues.current.get(record.id) || {};
    let updated = record;
    try {
      for (const [key, value] of Object.entries(changes)) {
        updated = await onRecordUpdate(updated, key, value);
      }
    } catch {
      return;
    }
    gridApi.current?.stopEditing();
    gridApi.current?.getRowNode(record.id)?.setData({ ...updated, values: { ...updated.values } });
    originalValues.current.delete(record.id);
    pendingValues.current.delete(record.id);
    setEditingRowId(null);
    onRecordFinishEdit(record.id);
  }

  function cancelEditing(record: WorkflowRecord) {
    gridApi.current?.stopEditing(true);
    const values = originalValues.current.get(record.id);
    if (values) {
      gridApi.current?.getRowNode(record.id)?.setData({ ...record, values: cloneValues(values) });
    }
    originalValues.current.delete(record.id);
    pendingValues.current.delete(record.id);
    setEditingRowId(null);
    onRecordFinishEdit(record.id);
  }
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
    usage: "sort",
  });
  const dynamicColumns: ColDef<WorkflowRecord>[] = (workflow?.columns || []).map(
    (column) => ({
      colId: column.key,
      headerName: column.label,
      enableRowGroup: true,
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
  const columnDefinitions: ColDef<WorkflowRecord>[] = [
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
    ...dynamicColumns,
    {
      colId: "actions",
      headerName: locale === "en" ? "Actions" : "操作",
      pinned: "right",
      width: 108,
      minWidth: 108,
      maxWidth: 108,
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
          onEdit={beginEditing}
          onFinishEdit={() => parameters.data ? finishEditing(parameters.data) : Promise.resolve()}
          onCancelEdit={() => {
            if (parameters.data) cancelEditing(parameters.data);
          }}
          onDelete={onRecordDelete}
        />
      ),
    },
  ];
  const profileStorageKey = profileKey && workflow?.key
    ? `orbit:grid-profile:${profileKey}:${workflow.key}`
    : null;

  function saveColumnProfile(api: GridApi<WorkflowRecord>) {
    if (!profileStorageKey) return;
    window.localStorage.setItem(profileStorageKey, JSON.stringify(api.getColumnState()));
  }

  function restoreColumnProfile(api: GridApi<WorkflowRecord>) {
    if (!profileStorageKey) return;
    const raw = window.localStorage.getItem(profileStorageKey);
    if (!raw) return;
    try {
      api.applyColumnState({ state: JSON.parse(raw) as ColumnState[], applyOrder: true });
    } catch {
      window.localStorage.removeItem(profileStorageKey);
    }
  }

  function resetColumnProfile() {
    gridApi.current?.resetColumnState();
    if (profileStorageKey) window.localStorage.removeItem(profileStorageKey);
  }

  useEffect(() => {
    if (gridApi.current) restoreColumnProfile(gridApi.current);
  }, [profileStorageKey]);
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

  function handleCellChanged(event: CellValueChangedEvent<WorkflowRecord>) {
    const record = event.data;
    const key = event.colDef.colId;
    if (!record || !key || key === "record_order" || key === "actions" || event.newValue === event.oldValue) {
      return;
    }
    const changes = pendingValues.current.get(record.id) || {};
    changes[key] = event.newValue;
    pendingValues.current.set(record.id, changes);
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
        <button
          className="grid-layout-reset-button"
          type="button"
          aria-label={locale === "en" ? "Reset grid layout" : "重置表格布局"}
          title={locale === "en" ? "Reset grid layout" : "重置表格布局"}
          onClick={resetColumnProfile}
        >
          {locale === "en" ? "Reset layout" : "重置布局"}
        </button>
      </div>
      <AgGridReact<WorkflowRecord>
        key={`${workflow?.key || "grid"}-${locale}-${theme}`}
        containerStyle={{ width: "100%", height: "100%" }}
        theme={theme === "light" ? orbitGridTheme : theme === "black" ? orbitGridBlackTheme : orbitGridGreenTheme}
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
        sideBar={{
          toolPanels: [
            {
              id: "columns",
              labelDefault: "Columns",
              labelKey: "columns",
              iconKey: "columns",
              toolPanel: "agColumnsToolPanel",
              toolPanelParams: {
                suppressRowGroups: false,
                suppressValues: true,
                suppressPivots: true,
                suppressPivotMode: true,
              },
            },
          ],
          defaultToolPanel: "columns",
        }}
        rowGroupPanelShow="always"
        suppressHorizontalScroll={false}
        alwaysShowHorizontalScroll
        suppressAnimationFrame
        suppressRowTransform
        enableBrowserTooltips
        ensureDomOrder
        onCellFocused={handleCellFocused}
        onCellClicked={handleCellClicked}
        onGridReady={(event: GridReadyEvent<WorkflowRecord>) => {
          gridApi.current = event.api;
          restoreColumnProfile(event.api);
        }}
        onColumnMoved={(event) => saveColumnProfile(event.api)}
        onColumnVisible={(event) => saveColumnProfile(event.api)}
        onColumnPinned={(event) => saveColumnProfile(event.api)}
        onColumnResized={(event) => {
          if (event.finished) saveColumnProfile(event.api);
        }}
        onColumnRowGroupChanged={(event) => saveColumnProfile(event.api)}
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
