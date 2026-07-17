import {
  themeQuartz,
  type CellFocusedEvent,
  type CellValueChangedEvent,
  type ColDef,
  type ICellRendererParams,
  type SortChangedEvent,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";

import type {
  ColumnDefinition,
  Locale,
  ThemeMode,
  WorkflowDetail,
  WorkflowRecord,
} from "../types";
import { translate } from "../i18n/translations";


const orbitGridTheme = themeQuartz.withParams({
  accentColor: "#e4572e",
  backgroundColor: "#fbfaf5",
  foregroundColor: "#172421",
  borderColor: "#c8c1b0",
  headerBackgroundColor: "#203a35",
  headerTextColor: "#fffaf0",
  oddRowBackgroundColor: "#f3f0e7",
  rowHoverColor: "#f8e1d5",
  selectedRowBackgroundColor: "#f4cfc0",
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
  records: WorkflowRecord[];
  loading: boolean;
  onCellSelect: (recordId: string, cellKey: string | null) => void;
  onRecordUpdate: (
    record: WorkflowRecord,
    key: string,
    value: unknown,
  ) => Promise<WorkflowRecord>;
  onRecordAdd: () => Promise<WorkflowRecord>;
  onRecordDelete: (record: WorkflowRecord) => Promise<void>;
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

export function WorkflowGrid({
  locale,
  theme,
  workflow,
  records,
  loading,
  onCellSelect,
  onRecordUpdate,
  onRecordAdd,
  onRecordDelete,
  onSortChange,
}: WorkflowGridProps) {
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
      editable: Boolean(workflow?.access.can_edit && column.editable),
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
      width: 132,
      minWidth: 132,
      sortable: false,
      filter: false,
      editable: false,
      cellRenderer: (parameters: ICellRendererParams<WorkflowRecord>) => {
        const wrapper = document.createElement("div");
        wrapper.className = "grid-row-actions";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "grid-row-action grid-row-action--delete";
        button.textContent = locale === "en" ? "Delete" : "删除";
        button.disabled = !workflow?.access.can_edit;
        button.addEventListener("click", () => {
          if (parameters.data) void onRecordDelete(parameters.data);
        });
        wrapper.appendChild(button);
        return wrapper;
      },
    },
  ];
  const rowData = records.map((record) => ({
    ...record,
    values: { ...record.values },
  }));

  function handleCellFocused(event: CellFocusedEvent<WorkflowRecord>) {
    if (event.rowIndex === null) return;
    const row = event.api.getDisplayedRowAtIndex(event.rowIndex)?.data;
    const cellKey =
      typeof event.column === "string"
        ? event.column
        : event.column?.getColId() || null;
    if (row) onCellSelect(row.tree_record_id || row.id, cellKey);
  }

  async function handleCellChanged(event: CellValueChangedEvent<WorkflowRecord>) {
    const record = event.data;
    const key = event.colDef.colId;
    if (!record || !key || key === "record_order" || key === "actions" || event.newValue === event.oldValue) {
      return;
    }
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
    <div className="grid-frame">
      <div className="grid-toolbar">
        <button
          className="grid-add-button"
          type="button"
          disabled={!workflow?.access.can_edit || loading}
          onClick={() => void onRecordAdd()}
        >
          + {locale === "en" ? "Add row" : "新增行"}
        </button>
      </div>
      <AgGridReact<WorkflowRecord>
        key={`${workflow?.key || "grid"}-${locale}-${theme}`}
        theme={theme === "dark" ? orbitGridDarkTheme : orbitGridTheme}
        rowData={rowData}
        columnDefs={columnDefinitions}
        defaultColDef={{
          sortable: true,
          filter: true,
          resizable: true,
          suppressHeaderMenuButton: false,
        }}
        getRowId={(parameters) => parameters.data.id}
        rowSelection={{
          mode: "singleRow",
          checkboxes: false,
          enableClickSelection: true,
        }}
        loading={loading}
        rowHeight={44}
        headerHeight={46}
        animateRows
        enableBrowserTooltips
        ensureDomOrder
        onCellFocused={handleCellFocused}
        onCellValueChanged={handleCellChanged}
        onSortChanged={handleSortChanged}
        overlayNoRowsTemplate={`<span class="grid-empty">${translate(locale, "noData")}</span>`}
      />
    </div>
  );
}
