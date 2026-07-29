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


export const orbitGridTheme = themeQuartz.withParams({
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

export const orbitGridNavyTheme = themeQuartz.withParams({
  accentColor: "#5fb8ff",
  backgroundColor: "#11203a",
  foregroundColor: "#e6eef9",
  borderColor: "#21385f",
  headerBackgroundColor: "#1f5fa0",
  headerTextColor: "#ffffff",
  oddRowBackgroundColor: "#0d1a2f",
  rowHoverColor: "#1c3463",
  selectedRowBackgroundColor: "#26467c",
  fontFamily: "IBM Plex Sans, Noto Sans SC, Noto Sans TC, sans-serif",
  fontSize: 13,
  spacing: 6,
  borderRadius: 0,
  wrapperBorderRadius: 0,
});

export const orbitGridGreenTheme = themeQuartz.withParams({
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

export const orbitGridBlackTheme = themeQuartz.withParams({
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
  selectedRecordId: string | null;
  onCellSelect: (recordId: string, cellKey: string | null) => void;
  onRecordUpdate: (
    record: WorkflowRecord,
    key: string,
    value: unknown,
  ) => Promise<WorkflowRecord>;
  onRecordCreate: (values: Record<string, unknown>) => Promise<WorkflowRecord>;
  onNewRecordSaved?: (record: WorkflowRecord) => void | Promise<void>;
  onRecordDelete: (record: WorkflowRecord) => Promise<void>;
  existingRecords: WorkflowRecord[];
  onRecordFinishEdit: (recordId: string) => void;
  onSortChange: (sortBy: string, direction: "asc" | "desc") => void;
  profileKey: string | null;
  currentUserId: string | null;
  ownerOnly: boolean;
  onOwnerOnlyChange: (ownerOnly: boolean) => void;
  canEdit: boolean;
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

function formatSaveError(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (reason && typeof reason === "object") {
    const error = reason as { data?: unknown; error?: unknown };
    if (error.data && typeof error.data === "object" && "detail" in error.data) {
      return String(error.data.detail);
    }
    if (typeof error.error === "string") return error.error;
  }
  return "Unable to save the record. Please review the values and try again.";
}

const OPTIONAL_ORDER_FIELDS = new Set([
  "evaluation_result",
  "status",
  "package_type",
  "target_laboratory",
  "notes",
]);

function isRequiredOrderField(workflowKey: string | undefined, column: ColumnDefinition): boolean {
  return workflowKey === "order-evaluation" && column.editable && !OPTIONAL_ORDER_FIELDS.has(column.key);
}

function CustomerRelationsActionHeader({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="business-entity-header"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="business-entity-help-button"
        aria-label={translate(locale, "customerRelationsActionHelpTitle")}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >?
      </button>
      {open ? (
        <div className="business-entity-help-popover" role="tooltip" onClick={(event) => event.stopPropagation()}>
          <p>{translate(locale, "customerRelationsActionHelpBody")}</p>
        </div>
      ) : null}
    </div>
  );
}

interface RowActionRendererProps {
  data: WorkflowRecord | undefined;
  canEdit: boolean;
  canDuplicate: boolean;
  locale: Locale;
  onEdit: (record: WorkflowRecord) => void;
  onDuplicate: (record: WorkflowRecord) => void;
  onDelete: (record: WorkflowRecord) => Promise<void>;
}

function RowActionRenderer({
  data,
  canEdit,
  canDuplicate,
  locale,
  onEdit,
  onDuplicate,
  onDelete,
}: RowActionRendererProps) {
  return (
    <div className="grid-row-actions">
      <button
        type="button"
        className="grid-row-action grid-row-action--edit"
        aria-label="Edit row"
        title="Edit row"
        disabled={!canEdit}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (data) {
            onEdit(data);
          }
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          <path d="m4 16-.8 4.8L8 20l10.8-10.8-4-4L4 16Zm9.4-9.4 4 4" />
        </svg>
      </button>
      <button
        type="button"
        className="grid-row-action grid-row-action--duplicate"
        aria-label={locale === "en" ? "Duplicate row" : "复制行"}
        title={locale === "en" ? "Duplicate row" : "复制行"}
        disabled={!canDuplicate}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (data) onDuplicate(data);
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          <path d="M8 8h11v11H8zM5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1" />
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
  selectedRecordId,
  onCellSelect,
  onRecordUpdate,
  onRecordCreate,
  onNewRecordSaved,
  onRecordDelete,
  existingRecords,
  onRecordFinishEdit,
  onSortChange,
  profileKey,
  currentUserId,
  ownerOnly,
  onOwnerOnlyChange,
  canEdit,
}: WorkflowGridProps) {
  const [editingRecord, setEditingRecord] = useState<WorkflowRecord | null>(null);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [editValidationErrors, setEditValidationErrors] = useState<Record<string, string>>({});
  const [newRecordId, setNewRecordId] = useState<string | null>(null);
  const gridApi = useRef<GridApi<WorkflowRecord> | null>(null);
  const inlineEditAllowed = Boolean(canEdit && workflow?.access.can_edit && workflow.key === "order-evaluation");

  function applySelectedRow(api: GridApi<WorkflowRecord>) {
    api.forEachNode((node) => {
      node.setSelected(Boolean(selectedRecordId && node.data?.id === selectedRecordId));
    });
  }

  useEffect(() => {
    if (!gridApi.current) return;
    const firstFrame = window.requestAnimationFrame(() => {
      if (!gridApi.current) return;
      applySelectedRow(gridApi.current);
      window.requestAnimationFrame(() => {
        if (gridApi.current) applySelectedRow(gridApi.current);
      });
    });
    return () => window.cancelAnimationFrame(firstFrame);
  }, [selectedRecordId, existingRecords]);

  function openEditDialog(record: WorkflowRecord) {
    setEditingRecord(record);
    setEditValues({ ...record.values });
    setEditError("");
    setEditValidationErrors({});
  }

  function closeEditDialog() {
    if (editBusy) return;
    setEditingRecord(null);
    setEditError("");
    setEditValidationErrors({});
  }

  function duplicateSignature(values: Record<string, unknown>): string {
    return (workflow?.columns || [])
      .filter((column) => column.editable)
      .map((column) => {
        const value = values[column.key];
        if (value === null || value === undefined) return [column.key, ""];
        if (typeof value === "string") return [column.key, value.trim()];
        return [column.key, value];
      })
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("|");
  }

  function openDuplicateDialog(record: WorkflowRecord) {
    const draftId = `draft-${crypto.randomUUID()}`;
    const duplicate: WorkflowRecord = {
      ...record,
      id: draftId,
      tree_record_id: null,
      record_key: draftId,
      record_order: 0,
      label: locale === "en" ? `Copy of ${record.label || record.record_key}` : `复制 ${record.label || record.record_key}`,
      values: { ...record.values },
      source_row: null,
      source_cells: {},
      version: 1,
      updated_at: new Date().toISOString(),
    };
    setNewRecordId(draftId);
    openEditDialog(duplicate);
  }

  async function saveEditDialog() {
    if (!editingRecord) return;
    const validationErrors: Record<string, string> = {};
    if (workflow?.key === "order-evaluation") {
      for (const column of workflow.columns) {
        if (!isRequiredOrderField(workflow.key, column)) continue;
        const value = editValues[column.key];
        const empty = value === null || value === undefined || String(value).trim() === "";
        if (empty) {
          validationErrors[column.key] = locale === "en" ? "This field is required" : "此字段为必填项";
        } else if (column.data_type === "integer" && (!Number.isInteger(Number(value)) || Number(value) < 1)) {
          validationErrors[column.key] = locale === "en" ? "Enter a positive whole number" : "请输入正整数";
        }
      }
    }
    const duplicate = existingRecords.find(
      (record) => record.id !== editingRecord.id
        && duplicateSignature(record.values) === duplicateSignature(editValues),
    );
    if (duplicate) {
      setEditError(locale === "en"
        ? "An identical row already exists. Change at least one field before saving."
        : "已存在完全相同的记录。保存前请至少修改一个字段。");
      return;
    }
    if (Object.keys(validationErrors).length > 0) {
      setEditValidationErrors(validationErrors);
      setEditError(locale === "en" ? "Please complete the required fields before saving." : "保存前请填写所有必填字段。");
      return;
    }
    setEditValidationErrors({});
    setEditBusy(true);
    setEditError("");
    const isNewRecord = newRecordId === editingRecord.id;
    let updated = editingRecord;
    try {
      if (isNewRecord) {
        updated = await onRecordCreate(editValues);
      } else {
        for (const column of workflow?.columns || []) {
          if (!column.editable || editValues[column.key] === editingRecord.values[column.key]) continue;
          updated = await onRecordUpdate(updated, column.key, editValues[column.key]);
        }
      }
      if (!isNewRecord) {
        gridApi.current?.getRowNode(updated.id)?.setData({ ...updated, values: { ...updated.values } });
        onRecordFinishEdit(updated.id);
      }
      if (isNewRecord) {
        setNewRecordId(null);
        onNewRecordSaved?.(updated);
      }
      setEditingRecord(null);
    } catch (reason) {
      setEditError(formatSaveError(reason));
    } finally {
      setEditBusy(false);
    }
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
      editable: inlineEditAllowed && column.editable,
      cellEditor: column.data_type === "boolean" ? "agCheckboxCellEditor" : undefined,
      valueParser: (parameters) => {
        if (column.data_type === "integer") return Number.parseInt(String(parameters.newValue), 10);
        if (column.data_type === "decimal") return Number.parseFloat(String(parameters.newValue));
        return parameters.newValue;
      },
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
      width: 100,
      minWidth: 100,
      maxWidth: 100,
      sortable: false,
      filter: false,
      editable: false,
      cellRenderer: (parameters: ICellRendererParams<WorkflowRecord>) => (
        <RowActionRenderer
          data={parameters.data}
          canEdit={Boolean(canEdit && workflow?.access.can_edit)}
          canDuplicate={Boolean(canEdit && workflow?.access.can_edit) && (workflow?.key === "order-evaluation" || workflow?.group_key === "hr")}
          locale={locale}
          onEdit={openEditDialog}
          onDuplicate={openDuplicateDialog}
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

  function openNewRecordDialog() {
    const draftId = `draft-${crypto.randomUUID()}`;
    const values = Object.fromEntries(
      (workflow?.columns || [])
        .filter((column) => column.editable)
        .map((column) => [column.key, ""]),
    );
    const draft: WorkflowRecord = {
      id: draftId,
      tree_record_id: null,
      record_key: draftId,
      record_order: 0,
      label: locale === "en" ? "New record" : "新记录",
      label_i18n: { en: "New record", zh_CN: "新记录", zh_HK: "新記錄" },
      values,
      source_row: null,
      source_cells: {},
      version: 1,
      updated_at: new Date().toISOString(),
    };
    setNewRecordId(draftId);
    openEditDialog(draft);
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
      if (ownerOnly) query.set("owner_only", "true");
      const token = localStorage.getItem("orbit:auth-token");
      const requestInit: RequestInit = token
        ? { headers: { "X-Orbit-Auth": token } }
        : {};
      void fetch("/api/v1/workflows/" + encodeURIComponent(workflow.key) + "/records?" + query, requestInit)
        .then(async (response) => {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json() as Promise<{ items: WorkflowRecord[]; total: number }>;
        })
        .then((page) => {
          parameters.successCallback(page.items, page.total);
          window.requestAnimationFrame(() => {
            if (gridApi.current) applySelectedRow(gridApi.current);
          });
        })
        .catch(() => parameters.failCallback());
    },
  }), [locale, ownerOnly, search, workflow?.key]);

  useEffect(() => {
    if (!gridApi.current) return;
    gridApi.current.setGridOption("datasource", datasource);
  }, [datasource]);

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
      {workflow?.group_key !== "hr" && currentUserId ? (
        <label className="grid-owner-filter">
          <span>{locale === "en" ? "My records" : locale === "zh-HK" ? "我的記錄" : "我的记录"}</span>
          <button
            type="button"
            className={`grid-toggle ${ownerOnly ? "is-on" : ""}`}
            role="switch"
            aria-checked={ownerOnly}
            aria-label={locale === "en" ? "Show only records owned by me" : locale === "zh-HK" ? "只顯示由我負責的記錄" : "只显示由我负责的记录"}
            onClick={() => onOwnerOnlyChange(!ownerOnly)}
          >
            <span className="grid-toggle__thumb" aria-hidden="true" />
          </button>
        </label>
      ) : null}
      {workflow?.group_key !== "hr" ? (
        <div className="grid-toolbar-actions">
          <CustomerRelationsActionHeader locale={locale} />
          {workflow?.key === "order-evaluation" ? <button
            className="grid-add-button"
            type="button"
            aria-label={locale === "en" ? "Add row" : "新增行"}
            title={locale === "en" ? "Add row" : "新增行"}
            disabled={!inlineEditAllowed || loading}
            onClick={openNewRecordDialog}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button> : null}
        </div>
      ) : null}
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
        key={`${workflow?.key || "grid"}-${locale}-${theme}-${ownerOnly}`}
        containerStyle={{ width: "100%", height: "100%" }}
        theme={
          theme === "navy"
            ? orbitGridNavyTheme
            : theme === "light"
              ? orbitGridTheme
              : theme === "black"
                ? orbitGridBlackTheme
                : orbitGridGreenTheme
        }
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
        onCellValueChanged={(event: CellValueChangedEvent<WorkflowRecord>) => {
          const key = event.colDef.colId;
          if (!inlineEditAllowed || !event.data || !key || key === "record_order" || key === "actions") return;
          const column = workflow?.columns.find((item) => item.key === key);
          if (!column?.editable) return;
          const changedRecord = {
            ...event.data,
            values: { ...event.data.values, [key]: event.newValue },
          };
          void onRecordUpdate(changedRecord, key, event.newValue)
            .then((updated) => {
              event.node.setData({ ...updated, values: { ...updated.values } });
              onRecordFinishEdit(updated.id);
            })
            .catch(() => {
              event.node.setData({
                ...event.data,
                values: { ...event.data.values, [key]: event.oldValue },
              });
            });
        }}
        onGridReady={(event: GridReadyEvent<WorkflowRecord>) => {
          gridApi.current = event.api;
          restoreColumnProfile(event.api);
          window.requestAnimationFrame(() => applySelectedRow(event.api));
        }}
        onColumnMoved={(event) => saveColumnProfile(event.api)}
        onColumnVisible={(event) => saveColumnProfile(event.api)}
        onColumnPinned={(event) => saveColumnProfile(event.api)}
        onColumnResized={(event) => {
          if (event.finished) saveColumnProfile(event.api);
        }}
        onColumnRowGroupChanged={(event) => saveColumnProfile(event.api)}
        onSortChanged={handleSortChanged}
        overlayNoRowsTemplate={`<span class="grid-empty">${translate(locale, "noData")}</span>`}
      />
      {loading ? (
        <div className="grid-loading" role="status" aria-label="Loading data">
          <span className="grid-loading__spinner" aria-hidden="true" />
        </div>
      ) : null}
      {editingRecord && workflow ? (
        <div className="dialog-backdrop grid-edit-backdrop" role="presentation">
          <section
            className="dialog-surface grid-edit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="grid-edit-title"
          >
            <header className="grid-edit-dialog__header">
              <div>
                <span className="confirm-dialog__eyebrow">
                  {locale === "en" ? "FULL RECORD EDIT" : "完整记录编辑"}
                </span>
                <h2 id="grid-edit-title">
                  {editingRecord.label || editingRecord.record_key}
                </h2>
              </div>
              <button
                type="button"
                className="grid-edit-dialog__close"
                aria-label={locale === "en" ? "Close" : "关闭"}
                onClick={closeEditDialog}
                disabled={editBusy}
              >
                ×
              </button>
            </header>
            <div className="grid-edit-dialog__body">
              {workflow.columns.map((column) => {
                const value = editValues[column.key];
                const longText = ["notes", "system_action", "exception_branch", "guidance"].includes(column.key);
                const required = isRequiredOrderField(workflow.key, column);
                return (
                  <label className={`grid-edit-field ${longText ? "grid-edit-field--wide" : ""}`} key={column.key}>
                    <span>
                      {column.label}
                      {required ? <b className="grid-edit-field__required" aria-label={locale === "en" ? "required" : "必填"}>*</b> : null}
                      {!column.editable ? <small>{locale === "en" ? "Read-only" : "只读"}</small> : null}
                    </span>
                    {column.editable && column.data_type === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(event) => setEditValues((current) => ({ ...current, [column.key]: event.target.checked }))}
                        disabled={editBusy}
                      />
                    ) : column.editable && longText ? (
                      <textarea
                        value={displayValue(value, locale)}
                        onChange={(event) => setEditValues((current) => ({ ...current, [column.key]: event.target.value }))}
                        disabled={editBusy}
                        rows={4}
                      />
                    ) : column.editable ? (
                      <input
                        type={column.data_type === "date" ? "date" : column.data_type === "integer" || column.data_type === "decimal" ? "number" : "text"}
                        step={column.data_type === "decimal" ? "any" : undefined}
                        value={displayValue(value, locale)}
                        onChange={(event) => {
                          const raw = event.target.value;
                          const next = column.data_type === "integer" || column.data_type === "decimal"
                            ? raw === "" ? "" : Number(raw)
                            : raw;
                          setEditValues((current) => ({ ...current, [column.key]: next }));
                        }}
                        disabled={editBusy}
                      />
                    ) : (
                      <output>{displayValue(value, locale) || "—"}</output>
                    )}
                    {editValidationErrors[column.key] ? (
                      <small className="grid-edit-field__error">{editValidationErrors[column.key]}</small>
                    ) : null}
                  </label>
                );
              })}
            </div>
            {editError ? <p className="grid-edit-dialog__error" role="alert">{editError}</p> : null}
            <footer className="dialog-actions grid-edit-dialog__actions">
              <button type="button" className="confirm-dialog__cancel" onClick={closeEditDialog} disabled={editBusy}>
                <svg className="grid-edit-action__icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
                {locale === "en" ? "Cancel" : "取消"}
              </button>
              <button type="button" className="confirm-dialog__confirm" onClick={() => void saveEditDialog()} disabled={editBusy || !workflow.access.can_edit}>
                <svg className="grid-edit-action__icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                  <path d="M5 4h12l2 2v14H5zM8 4v6h8V4M8 20v-6h8v6" />
                </svg>
                {editBusy ? (locale === "en" ? "Saving…" : "保存中…") : locale === "en" ? "Save changes" : "保存更改"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
