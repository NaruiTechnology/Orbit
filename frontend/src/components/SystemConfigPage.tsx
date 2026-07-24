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
interface AccessRole { code: string; name: string }
interface AccessUserRow {
  id: string;
  login_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  company_name: string;
  site: string;
  is_active: boolean;
  created_at: string;
  last_sign_in: string | null;
  role_code: string;
  role_name: string;
  isDraft?: boolean;
}
interface AccessResponse { roles: AccessRole[]; users: AccessUserRow[] }
type AccessTextField = "first_name" | "last_name" | "email" | "phone_number" | "company_name" | "site";

function AccessTextCell({ data, value, field, editing, onChange }: ICellRendererParams<AccessUserRow> & { field: AccessTextField; editing: boolean; onChange: (field: AccessTextField, value: string) => void }) {
  if (!data) return null;
  if (!editing) return <span>{String(value ?? "")}</span>;
  return <input className="admin-grid-input" value={String(value ?? "")} aria-label={field} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); onChange(field, event.target.value); }} />;
}

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
  const [topTab, setTopTab] = useState<"customer-relations" | "people-operations" | "access-management">("customer-relations");
  const [customerSubTab, setCustomerSubTab] = useState<"steps" | "templates">("steps");
  const [workflowKey, setWorkflowKey] = useState("order-evaluation");
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [access, setAccess] = useState<AccessResponse | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [accessDirtyRows, setAccessDirtyRows] = useState<Record<string, AccessUserRow>>({});
  const [accessDeletedIds, setAccessDeletedIds] = useState<string[]>([]);
  const [accessEditingIds, setAccessEditingIds] = useState<Record<string, boolean>>({});
  const [accessSaving, setAccessSaving] = useState(false);
  const [dirtyRows, setDirtyRows] = useState<Record<string, StepRow>>({});
  const dirtyRowsRef = useRef<Record<string, StepRow>>({});
  const gridApiRef = useRef<GridApi<StepRow> | null>(null);
  const accessGridApiRef = useRef<GridApi<AccessUserRow> | null>(null);

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

  useEffect(() => {
    if (topTab !== "access-management") return;
    let cancelled = false;
    setAccessLoading(true); setAccessError("");
    fetch(`/api/v1/admin/access-management?locale=${locale}`, {
      headers: { "X-Orbit-Auth": localStorage.getItem("orbit:auth-token") || "" },
    })
      .then(async (response) => {
        if (response.status === 401) { onAuthRequired(); throw new Error("Session expired. Please sign in again."); }
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `HTTP ${response.status}`);
        return response.json() as Promise<AccessResponse>;
      })
      .then((next) => { if (!cancelled) { setAccess(next); setAccessDirtyRows({}); setAccessDeletedIds([]); setAccessEditingIds({}); } })
      .catch((reason) => { if (!cancelled) setAccessError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!cancelled) setAccessLoading(false); });
    return () => { cancelled = true; };
  }, [authToken, locale, onAuthRequired, topTab]);

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

  function changeAccessRow(row: AccessUserRow, patch: Partial<AccessUserRow>) {
    const next = { ...row, ...patch };
    setAccess((current) => current ? { ...current, users: current.users.map((item) => item.id === row.id ? next : item) } : current);
    setAccessDirtyRows((current) => ({ ...current, [next.id]: next }));
  }

  function addAccessRow(source?: AccessUserRow) {
    const id = `draft-${crypto.randomUUID()}`;
    const draft: AccessUserRow = { id, login_name: source ? `${source.login_name}-copy` : "", first_name: source?.first_name || "", last_name: source?.last_name || "", email: source?.email || "", phone_number: source?.phone_number || "", company_name: source?.company_name || "", site: source?.site || "Beijing(北京)", is_active: true, created_at: "", last_sign_in: null, role_code: source?.role_code || "user", role_name: source?.role_name || "User", isDraft: true };
    setAccess((current) => current ? { ...current, users: [draft, ...current.users] } : { roles: [], users: [draft] });
    setAccessDirtyRows((current) => ({ ...current, [id]: draft }));
    setAccessEditingIds((current) => ({ ...current, [id]: true }));
  }

  function deleteAccessRow(row: AccessUserRow) {
    if (!row.isDraft && !window.confirm(locale === "en" ? "Delete this account?" : "删除此账户？")) return;
    setAccess((current) => current ? { ...current, users: current.users.filter((item) => item.id !== row.id) } : current);
    if (!row.isDraft) setAccessDeletedIds((current) => [...current, row.id]);
    setAccessDirtyRows((current) => { const next = { ...current }; delete next[row.id]; return next; });
  }

  async function saveAccessAll() {
    if (!accessDirtyRows || (!Object.keys(accessDirtyRows).length && !accessDeletedIds.length)) return;
    setAccessSaving(true); setAccessError("");
    try {
      for (const id of accessDeletedIds) {
        const response = await fetch(`/api/v1/admin/access-management/users/${id}`, { method: "DELETE", headers: { "X-Orbit-Auth": localStorage.getItem("orbit:auth-token") || "" } });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `HTTP ${response.status}`);
      }
      for (const row of Object.values(accessDirtyRows)) {
        const body = { login_name: row.login_name, first_name: row.first_name, last_name: row.last_name, email: row.email, phone_number: row.phone_number, company_name: row.company_name, site: row.site, role_code: row.role_code, is_active: row.is_active };
        const response = await fetch(row.isDraft ? "/api/v1/admin/access-management/users" : `/api/v1/admin/access-management/users/${row.id}`, { method: row.isDraft ? "POST" : "PATCH", headers: { "Content-Type": "application/json", "X-Orbit-Auth": localStorage.getItem("orbit:auth-token") || "" }, body: JSON.stringify(row.isDraft ? body : { role_code: row.role_code, is_active: row.is_active }) });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `HTTP ${response.status}`);
      }
      const refreshed = await fetch(`/api/v1/admin/access-management?locale=${locale}`, { headers: { "X-Orbit-Auth": localStorage.getItem("orbit:auth-token") || "" } });
      if (!refreshed.ok) throw new Error(`HTTP ${refreshed.status}`);
      setAccess(await refreshed.json() as AccessResponse); setAccessDirtyRows({}); setAccessDeletedIds([]); setAccessEditingIds({});
    } catch (reason) { setAccessError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setAccessSaving(false); }
  }

  const accessColumns = useMemo<ColDef<AccessUserRow>[]>(() => [
    { field: "login_name", headerName: locale === "en" ? "Login" : "登录名", minWidth: 170, pinned: "left", enableRowGroup: true },
    { field: "first_name", headerName: locale === "en" ? "First name" : "名", minWidth: 130, cellRenderer: (params: ICellRendererParams<AccessUserRow>) => <AccessTextCell {...params} field="first_name" editing={Boolean(params.data && accessEditingIds[params.data.id])} onChange={(field, value) => params.data && changeAccessRow(params.data, { [field]: value })} /> },
    { field: "last_name", headerName: locale === "en" ? "Last name" : "姓", minWidth: 130, cellRenderer: (params: ICellRendererParams<AccessUserRow>) => <AccessTextCell {...params} field="last_name" editing={Boolean(params.data && accessEditingIds[params.data.id])} onChange={(field, value) => params.data && changeAccessRow(params.data, { [field]: value })} /> },
    { field: "email", headerName: locale === "en" ? "Email" : "电子邮件", minWidth: 230, cellRenderer: (params: ICellRendererParams<AccessUserRow>) => <AccessTextCell {...params} field="email" editing={Boolean(params.data && accessEditingIds[params.data.id])} onChange={(field, value) => params.data && changeAccessRow(params.data, { [field]: value })} /> },
    { field: "phone_number", headerName: locale === "en" ? "Phone" : "电话", minWidth: 150, cellRenderer: (params: ICellRendererParams<AccessUserRow>) => <AccessTextCell {...params} field="phone_number" editing={Boolean(params.data && accessEditingIds[params.data.id])} onChange={(field, value) => params.data && changeAccessRow(params.data, { [field]: value })} /> },
    { field: "company_name", headerName: locale === "en" ? "Company" : "公司", minWidth: 170, cellRenderer: (params: ICellRendererParams<AccessUserRow>) => <AccessTextCell {...params} field="company_name" editing={Boolean(params.data && accessEditingIds[params.data.id])} onChange={(field, value) => params.data && changeAccessRow(params.data, { [field]: value })} /> },
    { field: "site", headerName: locale === "en" ? "Site" : "站点", minWidth: 150, cellRenderer: (params: ICellRendererParams<AccessUserRow>) => <AccessTextCell {...params} field="site" editing={Boolean(params.data && accessEditingIds[params.data.id])} onChange={(field, value) => params.data && changeAccessRow(params.data, { [field]: value })} /> },
    {
      field: "role_code", headerName: locale === "en" ? "Access role" : "访问角色", minWidth: 160, editable: false,
      cellRenderer: (params: ICellRendererParams<AccessUserRow>) => params.data ? <select className="admin-grid-select" value={params.data.role_code} aria-label="Access role" onClick={(event) => event.stopPropagation()} onChange={(event) => { changeAccessRow(params.data!, { role_code: event.target.value }); }}>
        {(access?.roles || []).map((role) => <option key={role.code} value={role.code}>{role.name}</option>)}
      </select> : null,
    },
    {
      field: "is_active", headerName: locale === "en" ? "Active" : "启用", width: 110, editable: false,
      cellRenderer: (params: ICellRendererParams<AccessUserRow>) => params.data ? <input type="checkbox" checked={params.data.is_active} aria-label={`${params.data.login_name} active`} onClick={(event) => event.stopPropagation()} onChange={(event) => { changeAccessRow(params.data!, { is_active: event.target.checked }); }} /> : null,
    },
    { field: "last_sign_in", headerName: locale === "en" ? "Last sign-in" : "最后登录", minWidth: 190, valueFormatter: (params) => params.value ? new Date(params.value).toLocaleString(locale === "en" ? "en-US" : "zh-CN") : "—" },
    { field: "created_at", headerName: locale === "en" ? "Signed up" : "注册时间", minWidth: 190, valueFormatter: (params) => params.value ? new Date(params.value).toLocaleString(locale === "en" ? "en-US" : "zh-CN") : "—" },
    { colId: "actions", headerName: locale === "en" ? "Actions" : "操作", pinned: "right", width: 132, sortable: false, filter: false, cellRenderer: (params: ICellRendererParams<AccessUserRow>) => params.data ? <div className="grid-row-actions">
      <button type="button" className="grid-row-action grid-row-action--edit" title="Edit row" aria-label="Edit row" onMouseDown={(event) => event.stopPropagation()} onClick={() => setAccessEditingIds((current) => ({ ...current, [params.data!.id]: !current[params.data!.id] }))}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 16-.8 4.8L8 20 18.8 9.2l-4-4L4 16Zm9.4-9.4 4 4" /></svg></button>
      <button type="button" className="grid-row-action grid-row-action--duplicate" title="Copy row" aria-label="Copy row" onMouseDown={(event) => event.stopPropagation()} onClick={() => addAccessRow(params.data)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 8h11v11H8zM5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1" /></svg></button>
      <button type="button" className="grid-row-action grid-row-action--delete" title="Delete row" aria-label="Delete row" onMouseDown={(event) => event.stopPropagation()} onClick={() => deleteAccessRow(params.data!)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M10 11v6m4-6v6M9 7V4h6v3m-9 0 1 13h8l1-13" /></svg></button>
    </div> : null },
  ], [access?.roles, accessEditingIds, locale]);

  return <main className="system-config-page">
    <section className="system-config-card">
      <header className="system-config-card__header"><div><span className="system-config-kicker">System Config</span><h1>{translate(locale, "appSubtitle")}</h1></div><button className="system-config-back" type="button" onClick={onBack}>← {locale === "en" ? "Back to workspace" : "返回工作区"}</button></header>
      <nav className="system-config-tabs system-config-tabs--top" aria-label="System configuration sections" role="tablist">
        <button type="button" role="tab" aria-selected={topTab === "customer-relations"} onClick={() => setTopTab("customer-relations")}>{locale === "en" ? "Customer Relations" : locale === "zh-HK" ? "客戶關係" : "客户关系"}</button>
        <button type="button" role="tab" aria-selected={topTab === "people-operations"} onClick={() => setTopTab("people-operations")}>{locale === "en" ? "People Operations" : "人员运营"}</button>
        <button type="button" role="tab" aria-selected={topTab === "access-management"} onClick={() => setTopTab("access-management")}>{locale === "en" ? "Access Management" : locale === "zh-HK" ? "存取管理" : "访问管理"}</button>
      </nav>
      {topTab === "access-management" ? <section className="system-config-workflow-panel system-config-access-panel" aria-label="Access Management">
        <header className="system-config-workflow-heading"><div><h2>{locale === "en" ? "Access Management" : "访问管理"}</h2></div><span className="system-config-workflow-count">{access?.users.length || 0} {locale === "en" ? "accounts" : "个账户"}</span></header>
        {accessError && <p className="system-config-error" role="alert">{accessError}</p>}
        <div className="system-config-grid-toolbar"><div className="grid-toolbar"><button type="button" className="grid-add-button" aria-label="Add account" title="Add account" onClick={() => addAccessRow()}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></button><button type="button" className="grid-layout-reset-button system-config-save-all" disabled={accessSaving || (!Object.keys(accessDirtyRows).length && !accessDeletedIds.length)} onClick={() => void saveAccessAll()}><img src={saveIcon} alt="" aria-hidden="true" />{accessSaving ? "Saving…" : "Save all"}</button><button type="button" className="grid-layout-reset-button" onClick={() => accessGridApiRef.current?.resetColumnState()}>{locale === "en" ? "Reset grid" : "重置表格"}</button></div></div>
        <div className="system-config-grid grid-frame" aria-busy={accessLoading || accessSaving}><AgGridReact<AccessUserRow> theme={theme === "navy" ? orbitGridNavyTheme : theme === "light" ? orbitGridTheme : theme === "black" ? orbitGridBlackTheme : orbitGridGreenTheme} rowData={access?.users || []} columnDefs={accessColumns} defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, suppressHeaderMenuButton: false, enableRowGroup: true }} getRowId={(params) => String(params.data.id)} rowHeight={44} headerHeight={46} floatingFiltersHeight={34} enableBrowserTooltips ensureDomOrder suppressAnimationFrame sideBar={{ toolPanels: [{ id: "columns", labelDefault: "Columns", labelKey: "columns", iconKey: "columns", toolPanel: "agColumnsToolPanel", toolPanelParams: { suppressRowGroups: false, suppressValues: true, suppressPivots: true, suppressPivotMode: true } }], defaultToolPanel: "columns" }} rowGroupPanelShow="always" onGridReady={(event) => { accessGridApiRef.current = event.api; }} /></div>
      </section> : null}
      {topTab === "customer-relations" ? <nav className="system-config-tabs system-config-tabs--mode" aria-label="Customer Relations configuration" role="tablist">
        <button type="button" role="tab" aria-selected={customerSubTab === "steps"} onClick={() => setCustomerSubTab("steps")}>{translate(locale, "steps")}</button>
        <button type="button" role="tab" aria-selected={customerSubTab === "templates"} onClick={() => setCustomerSubTab("templates")}>{translate(locale, "templates")}</button>
      </nav> : null}
      {topTab === "customer-relations" && customerSubTab === "templates" ? <div className="system-config-business-panel">
        <SalesTemplatesPage locale={locale} theme={theme} />
      </div> : topTab !== "access-management" ? <section className="system-config-workflow-panel" aria-label={translate(locale, "steps")}>
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
      </section> : null}
    </section>
  </main>;
}
