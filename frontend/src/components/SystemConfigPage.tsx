import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { type ColDef, type GridApi, type ICellRendererParams } from "ag-grid-community";

import type { Locale, ThemeMode, WorkflowSummary } from "../types";
import { translate } from "../i18n/translations";
import { orbitGridBlackTheme, orbitGridGreenTheme, orbitGridNavyTheme, orbitGridTheme } from "./WorkflowGrid";
import { SalesTemplatesPage } from "./SalesTemplatesPage";
import saveIcon from "../assets/save-icon.svg";

interface Laboratory { id: string; code: string; name: string }
interface StepRow {
  id: string;
  record_key: string;
  record_order: number;
  step_name: string;
  sla: string | null;
  laboratory_id: string | null;
  laboratory_code: string | null;
  laboratory_name: string | null;
  phone_number: string;
  contact_email: string;
  contact_name: string;
  hr_employee_id: string | null;
}
interface ConfigResponse { workflow_key: string; workflow_name: string; laboratories: Laboratory[]; steps: StepRow[] }

type TextCellField = "phone_number" | "contact_email" | "contact_name";

function AdminTextCell({
  data,
  value,
  field,
  updateDraft,
  publishDirty,
  locale,
}: ICellRendererParams<StepRow> & {
  field: TextCellField;
  updateDraft: (step: StepRow) => void;
  publishDirty: () => void;
  locale: Locale;
}) {
  const [draft, setDraft] = useState(String(value ?? ""));

  useEffect(() => {
    setDraft(String(value ?? ""));
  }, [data?.id, field, value]);

  if (!data) return null;

  const placeholder = field === "contact_name"
    ? locale === "en" ? "Enter or search name" : "输入或搜索姓名"
    : undefined;

  return (
    <input
      className="admin-grid-input"
      value={draft}
      type={field === "contact_email" ? "email" : field === "phone_number" ? "tel" : "text"}
      placeholder={placeholder}
      aria-label={field === "contact_name" ? "Contact Name" : field}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDownCapture={(event) => event.stopPropagation()}
      onKeyUpCapture={(event) => event.stopPropagation()}
      onKeyPressCapture={(event) => event.stopPropagation()}
      onCopyCapture={(event) => event.stopPropagation()}
      onCutCapture={(event) => event.stopPropagation()}
      onPasteCapture={(event) => event.stopPropagation()}
      onChange={(event) => {
        event.stopPropagation();
        const updated = { ...data, [field]: event.target.value } as StepRow;
        setDraft(event.target.value);
        updateDraft(updated);
      }}
      onBlur={publishDirty}
    />
  );
}

export function SystemConfigPage({
  locale, theme, workflows, authToken, onBack, onAuthRequired,
}: {
  locale: Locale; theme: ThemeMode; workflows: WorkflowSummary[]; authToken: string | null; onBack: () => void; onAuthRequired: () => void;
}) {
  const [topTab, setTopTab] = useState<"customer-relations" | "people-operations">("customer-relations");
  const [customerSubTab, setCustomerSubTab] = useState<"steps" | "templates">("steps");
  const [workflowKey, setWorkflowKey] = useState("order-evaluation");
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [dirtyRows, setDirtyRows] = useState<Record<string, StepRow>>({});
  const dirtyRowsRef = useRef<Record<string, StepRow>>({});
  const gridApiRef = useRef<GridApi<StepRow> | null>(null);

  useEffect(() => {
    gridApiRef.current?.refreshCells({ columns: ["actions"], force: true });
  }, [dirtyRows, savingId, savingAll]);

  const subWorkflows = useMemo(() => workflows.filter((workflow) =>
    !workflow.is_master && workflow.definition_type === "workflow" &&
    (topTab === "people-operations" ? workflow.group_key === "hr" : workflow.group_key !== "hr")
  ), [topTab, workflows]);
  const selectedWorkflow = subWorkflows.find((workflow) => workflow.key === workflowKey) || null;

  function resetWorkflowGrid() {
    gridApiRef.current?.resetColumnState();
  }

  useEffect(() => {
    const firstWorkflow = subWorkflows[0];
    if (firstWorkflow && !subWorkflows.some((workflow) => workflow.key === workflowKey)) {
      setWorkflowKey(firstWorkflow.key);
    }
  }, [subWorkflows, workflowKey]);

  useEffect(() => {
    if (!selectedWorkflow || (topTab === "customer-relations" && customerSubTab === "templates")) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true); setError("");
    fetch(`/api/v1/admin/workflow-config/${encodeURIComponent(workflowKey)}?locale=${locale}`, {
      headers: { "X-Orbit-Auth": localStorage.getItem("orbit:auth-token") || "" },
    })
      .then(async (response) => {
        if (response.status === 401) { onAuthRequired(); throw new Error("Session expired. Please sign in again."); }
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `HTTP ${response.status}`);
        return response.json() as Promise<ConfigResponse>;
      })
      .then((next) => { if (!cancelled) { setConfig(next); dirtyRowsRef.current = {}; setDirtyRows({}); } })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authToken, customerSubTab, locale, selectedWorkflow, topTab, workflowKey]);

  const markDirty = useCallback((step: StepRow) => {
    dirtyRowsRef.current = { ...dirtyRowsRef.current, [step.id]: { ...step } };
    setDirtyRows(dirtyRowsRef.current);
  }, []);

  const updateDraft = useCallback((step: StepRow) => {
    dirtyRowsRef.current = { ...dirtyRowsRef.current, [step.id]: { ...step } };
    setDirtyRows({ ...dirtyRowsRef.current });
  }, []);

  const publishDirty = useCallback(() => {
    setDirtyRows({ ...dirtyRowsRef.current });
  }, []);

  const saveStep = useCallback(async (step: StepRow): Promise<boolean> => {
    setSavingId(step.id); setError("");
    try {
      const response = await fetch(`/api/v1/admin/workflow-config/${encodeURIComponent(workflowKey)}/steps/${step.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Orbit-Auth": localStorage.getItem("orbit:auth-token") || "" },
        body: JSON.stringify({ laboratory_id: step.laboratory_id || null, phone_number: step.phone_number, contact_email: step.contact_email, contact_name: step.contact_name, hr_employee_id: step.hr_employee_id || null }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `HTTP ${response.status}`);
      setConfig((current) => current
        ? { ...current, steps: current.steps.map((row) => row.id === step.id ? { ...row, ...step } : row) }
        : current);
      const nextDirtyRows = { ...dirtyRowsRef.current };
      delete nextDirtyRows[step.id];
      dirtyRowsRef.current = nextDirtyRows;
      setDirtyRows(nextDirtyRows);
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { setSavingId(null); }
  }, [workflowKey]);

  const saveAll = useCallback(async () => {
    const rows = Object.values(dirtyRowsRef.current);
    if (!rows.length) return;
    setSavingAll(true); setError("");
    await Promise.all(rows.map((row) => saveStep(row)));
    setSavingAll(false);
  }, [saveStep]);

  const columns = useMemo<ColDef<StepRow>[]>(() => [
    { field: "record_order", headerName: "#", width: 70, pinned: "left", editable: false },
    { field: "step_name", headerName: locale === "en" ? "Workflow step" : "工作流步骤", minWidth: 220, flex: 1, editable: false },
    { field: "sla", headerName: "SLA", minWidth: 120, width: 140, editable: false },
    {
      field: "laboratory_id", headerName: locale === "en" ? "Laboratory" : "实验室", minWidth: 210,
      editable: false,
      valueFormatter: (params) => config?.laboratories.find((lab) => lab.id === params.value)?.name || "",
      cellRenderer: (params: ICellRendererParams<StepRow>) => {
        const row = params.data;
        if (!row) return null;
        return <select className="admin-grid-select" value={row.laboratory_id || ""} aria-label="Laboratory" onClick={(event) => event.stopPropagation()} onChange={(event) => {
          event.stopPropagation();
          const laboratoryId = event.target.value || null;
          const laboratory = config?.laboratories.find((item) => item.id === laboratoryId);
          const updated = { ...row, laboratory_id: laboratoryId, laboratory_name: laboratory?.name || null, laboratory_code: laboratory?.code || null };
          params.node.setData(updated);
          markDirty(updated);
        }}>
          <option value="">{locale === "en" ? "Select laboratory" : locale === "zh-HK" ? "選擇實驗室" : "选择实验室"}</option>
          {(config?.laboratories || []).map((laboratory) => <option key={laboratory.id} value={laboratory.id}>{laboratory.name}</option>)}
        </select>;
      },
    },
    {
      field: "phone_number", headerName: locale === "en" ? "Phone Number" : "电话号码", minWidth: 210, editable: false,
      cellRenderer: (params: ICellRendererParams<StepRow>) => <AdminTextCell {...params} field="phone_number" updateDraft={updateDraft} publishDirty={publishDirty} locale={locale} />,
    },
    {
      field: "contact_email", headerName: locale === "en" ? "Email address" : "电子邮件", minWidth: 250, editable: false,
      cellRenderer: (params: ICellRendererParams<StepRow>) => <AdminTextCell {...params} field="contact_email" updateDraft={updateDraft} publishDirty={publishDirty} locale={locale} />,
    },
    {
      field: "contact_name", headerName: locale === "en" ? "Contact Name" : "联系人姓名", minWidth: 210, editable: false,
      cellRenderer: (params: ICellRendererParams<StepRow>) => <AdminTextCell {...params} field="contact_name" updateDraft={updateDraft} publishDirty={publishDirty} locale={locale} />,
    },
    {
      colId: "actions",
      headerName: locale === "en" ? "Actions" : "操作", width: 100, minWidth: 100, maxWidth: 100,
      pinned: "right", sortable: false, filter: false, editable: false,
      cellRenderer: (params: ICellRendererParams<StepRow>) => {
        const row = params.data;
        if (!row) return null;
        return <div className="grid-row-actions">
          <button type="button" className="grid-row-action grid-row-action--update" aria-label="Update row" title="Update row" disabled={!dirtyRowsRef.current[row.id] || savingId === row.id || savingAll} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => {
            event.stopPropagation();
            const latest = dirtyRowsRef.current[row.id] || row;
            void saveStep(latest).then((saved) => {
              if (saved) params.node.setData(latest);
            });
          }}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>
          </button>
          <button type="button" className="grid-row-action grid-row-action--delete" aria-label="Clear assignments" title="Clear assignments" disabled={savingId === row.id || savingAll} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); const cleared = { ...row, laboratory_id: null, laboratory_code: null, laboratory_name: null, phone_number: "", contact_email: "", contact_name: "", hr_employee_id: null }; params.node.setData(cleared); markDirty(cleared); }}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M10 11v6m4-6v6M9 7V4h6v3m-9 0 1 13h8l1-13" /></svg>
          </button>
        </div>;
      },
    },
  ], [config?.laboratories, locale, markDirty, publishDirty, saveStep, savingAll, savingId, updateDraft]);

  return <main className="system-config-page">
    <section className="system-config-card">
      <header className="system-config-card__header"><div><span className="system-config-kicker">System Config</span><h1>{translate(locale, "appSubtitle")}</h1></div><button className="system-config-back" type="button" onClick={onBack}>← {locale === "en" ? "Back to workspace" : "返回工作区"}</button></header>
      <nav className="system-config-tabs system-config-tabs--top" aria-label="System configuration sections" role="tablist">
        <button type="button" role="tab" aria-selected={topTab === "customer-relations"} onClick={() => setTopTab("customer-relations")}>{locale === "en" ? "Customer Relations" : locale === "zh-HK" ? "客戶關係" : "客户关系"}</button>
        <button type="button" role="tab" aria-selected={topTab === "people-operations"} onClick={() => setTopTab("people-operations")}>{locale === "en" ? "People Operations" : "人员运营"}</button>
      </nav>
      {topTab === "customer-relations" ? <nav className="system-config-tabs system-config-tabs--mode" aria-label="Customer Relations configuration" role="tablist">
        <button type="button" role="tab" aria-selected={customerSubTab === "steps"} onClick={() => setCustomerSubTab("steps")}>{translate(locale, "steps")}</button>
        <button type="button" role="tab" aria-selected={customerSubTab === "templates"} onClick={() => setCustomerSubTab("templates")}>{translate(locale, "templates")}</button>
      </nav> : null}
      {topTab === "customer-relations" && customerSubTab === "templates" ? <div className="system-config-business-panel">
        <SalesTemplatesPage locale={locale} theme={theme} />
      </div> : <section className="system-config-workflow-panel" aria-label={translate(locale, "steps")}>
        <nav className="system-config-tabs system-config-tabs--sub" aria-label={`${topTab} workflow steps`} role="tablist">
          {subWorkflows.map((workflow) => (
            <button type="button" role="tab" aria-selected={workflow.key === workflowKey} key={workflow.key} onClick={() => setWorkflowKey(workflow.key)}>
              {workflow.name}
            </button>
          ))}
        </nav>
        {selectedWorkflow ? <div className="system-config-workflow-content" role="tabpanel">
          <header className="system-config-workflow-heading">
            <div>
              <span className="system-config-kicker">{translate(locale, "steps")}</span>
              <h2>{selectedWorkflow.name}</h2>
            </div>
            <span className="system-config-workflow-count">{config?.steps.length || 0} {locale === "en" ? "steps" : "步骤"}</span>
          </header>
          {error && <p className="system-config-error" role="alert">{error}</p>}
          <div className="system-config-grid-toolbar"><button type="button" className="grid-layout-reset-button" aria-label={locale === "en" ? "Reset grid settings" : "重置表格设置"} title={locale === "en" ? "Reset grid settings" : "重置表格设置"} onClick={resetWorkflowGrid}>{locale === "en" ? "Reset grid" : locale === "zh-HK" ? "重置表格" : "重置表格"}</button><button type="button" className="grid-layout-reset-button system-config-save-all" disabled={!Object.keys(dirtyRows).length || savingAll || Boolean(savingId)} onClick={() => void saveAll()}><img src={saveIcon} alt="" aria-hidden="true" />{savingAll ? "Saving…" : "Save all"}</button></div>
          <div className="system-config-grid grid-frame" aria-busy={loading}><AgGridReact<StepRow> theme={theme === "navy" ? orbitGridNavyTheme : theme === "light" ? orbitGridTheme : theme === "black" ? orbitGridBlackTheme : orbitGridGreenTheme} rowData={config?.steps || []} columnDefs={columns} defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, suppressHeaderMenuButton: false }} stopEditingWhenCellsLoseFocus rowHeight={44} headerHeight={46} floatingFiltersHeight={34} enableBrowserTooltips ensureDomOrder suppressAnimationFrame onGridReady={(event) => { gridApiRef.current = event.api; }} onCellValueChanged={(event) => { if (event.data) markDirty(event.data); }} /></div>
        </div> : <div className="system-config-workflow-empty">{locale === "en" ? "Select a workflow panel to view its steps." : "请选择一个工作流面板查看步骤。"}</div>}
      </section>}
    </section>
  </main>;
}
