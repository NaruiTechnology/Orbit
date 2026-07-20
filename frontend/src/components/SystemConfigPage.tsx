import { useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { type ColDef, type ICellRendererParams } from "ag-grid-community";

import type { Locale, ThemeMode, WorkflowSummary } from "../types";
import { translate } from "../i18n/translations";
import { orbitGridBlackTheme, orbitGridGreenTheme, orbitGridNavyTheme, orbitGridTheme } from "./WorkflowGrid";

interface Laboratory { id: string; code: string; name: string }
interface StepRow {
  id: string;
  record_key: string;
  record_order: number;
  step_name: string;
  laboratory_id: string | null;
  laboratory_code: string | null;
  laboratory_name: string | null;
  contact_name: string;
  contact_email: string;
  hr_employee_id: string | null;
}
interface ConfigResponse { workflow_key: string; workflow_name: string; laboratories: Laboratory[]; steps: StepRow[] }

export function SystemConfigPage({
  locale, theme, workflows, authToken, onBack, onAuthRequired,
}: {
  locale: Locale; theme: ThemeMode; workflows: WorkflowSummary[]; authToken: string | null; onBack: () => void; onAuthRequired: () => void;
}) {
  const [topTab, setTopTab] = useState<"customer-relations" | "people-operations">("customer-relations");
  const [workflowKey, setWorkflowKey] = useState("order-evaluation");
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const subWorkflows = useMemo(() => workflows.filter((workflow) =>
    !workflow.is_master && workflow.definition_type === "workflow" &&
    (topTab === "people-operations" ? workflow.group_key === "hr" : workflow.group_key !== "hr")
  ), [topTab, workflows]);

  useEffect(() => {
    const firstWorkflow = subWorkflows[0];
    if (firstWorkflow && !subWorkflows.some((workflow) => workflow.key === workflowKey)) {
      setWorkflowKey(firstWorkflow.key);
    }
  }, [subWorkflows, workflowKey]);

  useEffect(() => {
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
      .then((next) => { if (!cancelled) setConfig(next); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authToken, locale, workflowKey]);

  async function saveStep(step: StepRow) {
    setSavingId(step.id); setError("");
    try {
      const response = await fetch(`/api/v1/admin/workflow-config/${encodeURIComponent(workflowKey)}/steps/${step.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Orbit-Auth": localStorage.getItem("orbit:auth-token") || "" },
        body: JSON.stringify({ laboratory_id: step.laboratory_id || null, contact_name: step.contact_name, contact_email: step.contact_email, hr_employee_id: step.hr_employee_id || null }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `HTTP ${response.status}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSavingId(null); }
  }

  const columns: ColDef<StepRow>[] = [
    { field: "record_order", headerName: "#", width: 70, pinned: "left", editable: false },
    { field: "step_name", headerName: locale === "en" ? "Workflow step" : "工作流步骤", minWidth: 220, flex: 1, editable: false },
    {
      field: "laboratory_id", headerName: locale === "en" ? "Laboratory" : "实验室", minWidth: 210,
      editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: ["", ...((config?.laboratories || []).map((lab) => lab.id))] },
      valueFormatter: (params) => config?.laboratories.find((lab) => lab.id === params.value)?.name || "",
      valueSetter: (params) => { if (!params.data) return false; params.data.laboratory_id = params.newValue || null; const lab = config?.laboratories.find((item) => item.id === params.data?.laboratory_id); params.data.laboratory_name = lab?.name || null; params.data.laboratory_code = lab?.code || null; return true; },
    },
    { field: "contact_name", headerName: locale === "en" ? "Internal contact name" : "内部联系人", minWidth: 210, editable: true },
    { field: "contact_email", headerName: locale === "en" ? "Email address" : "电子邮件", minWidth: 250, editable: true },
    { field: "hr_employee_id", headerName: locale === "en" ? "HR employee" : "HR员工", minWidth: 180, editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: [""] }, valueFormatter: () => "" },
    {
      headerName: locale === "en" ? "Actions" : "操作", width: 100, minWidth: 100, maxWidth: 100,
      pinned: "right", sortable: false, filter: false, editable: false,
      cellRenderer: (params: ICellRendererParams<StepRow>) => {
        const row = params.data;
        if (!row) return null;
        return <div className="grid-row-actions">
          <button type="button" className="grid-row-action grid-row-action--edit" aria-label="Edit row" title="Edit row" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (params.node.rowIndex !== null) params.api.startEditingCell({ rowIndex: params.node.rowIndex, colKey: "laboratory_id" }); }}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 16-.8 4.8L8 20l10.8-10.8-4-4L4 16Zm9.4-9.4 4 4" /></svg>
          </button>
          <button type="button" className="grid-row-action grid-row-action--delete" aria-label="Clear assignments" title="Clear assignments" disabled={savingId === row.id} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); const cleared = { ...row, laboratory_id: null, laboratory_code: null, laboratory_name: null, contact_name: "", contact_email: "", hr_employee_id: null }; params.node.setData(cleared); void saveStep(cleared); }}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M10 11v6m4-6v6M9 7V4h6v3m-9 0 1 13h8l1-13" /></svg>
          </button>
        </div>;
      },
    },
  ];

  return <main className="system-config-page">
    <section className="system-config-card">
      <header className="system-config-card__header"><div><span className="system-config-kicker">System Config</span><h1>{translate(locale, "appSubtitle")}</h1></div><button className="system-config-back" type="button" onClick={onBack}>← {locale === "en" ? "Main workspace" : "返回工作区"}</button></header>
      <nav className="system-config-tabs system-config-tabs--top" aria-label="System configuration sections" role="tablist">
        <button type="button" role="tab" aria-selected={topTab === "customer-relations"} onClick={() => setTopTab("customer-relations")}>{locale === "en" ? "Customer Relations" : "客户关系"}</button>
        <button type="button" role="tab" aria-selected={topTab === "people-operations"} onClick={() => setTopTab("people-operations")}>{locale === "en" ? "People Operations" : "人员运营"}</button>
      </nav>
      <nav className="system-config-tabs system-config-tabs--sub" aria-label="Workflow configuration" role="tablist">
        {subWorkflows.map((workflow) => <button type="button" role="tab" aria-selected={workflow.key === workflowKey} key={workflow.key} onClick={() => setWorkflowKey(workflow.key)}>{workflow.name}</button>)}
      </nav>
      {error && <p className="system-config-error" role="alert">{error}</p>}
      <div className="system-config-grid grid-frame" aria-busy={loading}><AgGridReact<StepRow> theme={theme === "navy" ? orbitGridNavyTheme : theme === "light" ? orbitGridTheme : theme === "black" ? orbitGridBlackTheme : orbitGridGreenTheme} rowData={config?.steps || []} columnDefs={columns} defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, suppressHeaderMenuButton: false }} stopEditingWhenCellsLoseFocus rowHeight={44} headerHeight={46} floatingFiltersHeight={34} enableBrowserTooltips ensureDomOrder suppressAnimationFrame onCellValueChanged={(event) => { if (event.data) void saveStep(event.data); }} /></div>
    </section>
  </main>;
}
