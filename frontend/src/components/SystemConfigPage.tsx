import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { type ColDef, type GridApi, type ICellRendererParams } from "ag-grid-community";

import type { Locale, ThemeMode, WorkflowSummary } from "../types";
import { translate } from "../i18n/translations";
import { orbitGridBlackTheme, orbitGridGreenTheme, orbitGridNavyTheme, orbitGridTheme } from "./WorkflowGrid";
import { SalesTemplatesPage } from "./SalesTemplatesPage";
import saveIcon from "../assets/save-icon.svg";
import { GEOLOCATION_SITES, normalizeSite } from "../geolocation";

interface Laboratory { id: string; code: string; name: string }
interface BusinessEntityOption { key: string; name: string }
interface StepRow {
  id: string;
  record_key: string;
  record_order: number;
  step_name: string;
  sla: string | null;
  businessEntity: string | null;
  laboratory_id: string | null;
  laboratory_code: string | null;
  laboratory_name: string | null;
  phone_number: string;
  contact_email: string;
  contact_name: string;
  hr_employee_id: string | null;
}
interface ConfigResponse { workflow_key: string; workflow_name: string; laboratories: Laboratory[]; businessEntities: BusinessEntityOption[]; steps: StepRow[] }
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
type AccessDialogMode = "add" | "edit" | "copy";
interface AccessDialogState { mode: AccessDialogMode; row: AccessUserRow }
type AccessDialogField = "login_name" | "first_name" | "last_name" | "email" | "phone_number" | "company_name" | "site" | "role_code";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERNS: Record<string, RegExp> = {
  CN: /^(?:\+?86)?1[3-9]\d{9}$/,
};
const COUNTRY_BY_SITE: Record<string, string> = {
  "Beijing(北京)": "CN", "Shanghai(上海)": "CN", "Shenzheng(深圳)": "CN", "Wuxi(无锡)": "CN",
  "Xian(西安)": "CN", "Chengdu(成都)": "CN", "Hangzhou(杭州)": "CN", "Tianjing(天津)": "CN", "Taixin(泰兴)": "CN",
};

type TextCellField = "phone_number" | "contact_email" | "contact_name";

function AdminTextCell({
  data,
  value,
  field,
  updateDraft,
  publishDirty,
  locale,
  readOnly = false,
}: ICellRendererParams<StepRow> & {
  field: TextCellField;
  updateDraft: (step: StepRow) => void;
  publishDirty: () => void;
  locale: Locale;
  readOnly?: boolean;
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
      readOnly={readOnly}
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
  const [accessDialog, setAccessDialog] = useState<AccessDialogState | null>(null);
  const [accessDialogError, setAccessDialogError] = useState("");
  const [accessDialogErrors, setAccessDialogErrors] = useState<Partial<Record<AccessDialogField, string>>>({});
  const [accessSaving, setAccessSaving] = useState(false);
  const [stepDialog, setStepDialog] = useState<StepRow | null>(null);
  const [stepDialogError, setStepDialogError] = useState("");
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
      .then((next) => { if (!cancelled) { setAccess(next); setAccessDirtyRows({}); setAccessDeletedIds([]); setAccessDialog(null); } })
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
        body: JSON.stringify({ businessEntity: step.businessEntity || null, sla: step.sla || null, laboratory_id: step.laboratory_id || null, phone_number: step.phone_number, contact_email: step.contact_email, contact_name: step.contact_name, hr_employee_id: step.hr_employee_id || null }),
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

  function updateStepDialog(patch: Partial<StepRow>) {
    setStepDialog((current) => current ? { ...current, ...patch } : current);
  }

  async function applyStepDialog() {
    if (!stepDialog) return;
    setStepDialogError("");
    const saved = await saveStep(stepDialog);
    if (saved) setStepDialog(null);
    else setStepDialogError(error || (locale === "en" ? "Could not save this workflow step." : "无法保存此工作流步骤。"));
  }

  const columns = useMemo<ColDef<StepRow>[]>(() => [
    { field: "record_order", headerName: "#", width: 70, pinned: "left", editable: false },
    { field: "step_name", headerName: locale === "en" ? "Workflow step" : "工作流步骤", minWidth: 220, flex: 1, editable: false },
    { field: "sla", headerName: "SLA", minWidth: 120, width: 140, editable: false },
    {
      field: "businessEntity", headerName: "Business entity", minWidth: 220, editable: false,
      cellRenderer: (params: ICellRendererParams<StepRow>) => {
        const row = params.data;
        if (!row) return null;
        return <select className="admin-grid-select" value={row.businessEntity || ""} aria-label="BusinessEntity" disabled onClick={(event) => event.stopPropagation()} onChange={(event) => {
          event.stopPropagation();
          const updated = { ...row, businessEntity: event.target.value || null };
          params.node.setData(updated);
          markDirty(updated);
        }}>
          <option value="">{locale === "en" ? "Select business entity" : "选择业务实体"}</option>
          {(config?.businessEntities || []).map((entity) => <option key={entity.key} value={entity.name}>{entity.name}</option>)}
        </select>;
      },
    },
    {
      field: "laboratory_id", headerName: locale === "en" ? "Laboratory" : "实验室", minWidth: 210,
      editable: false,
      valueFormatter: (params) => config?.laboratories.find((lab) => lab.id === params.value)?.name || "",
      cellRenderer: (params: ICellRendererParams<StepRow>) => {
        const row = params.data;
        if (!row) return null;
        return <select className="admin-grid-select" value={row.laboratory_id || ""} aria-label="Laboratory" disabled onClick={(event) => event.stopPropagation()} onChange={(event) => {
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
      cellRenderer: (params: ICellRendererParams<StepRow>) => <AdminTextCell {...params} field="phone_number" updateDraft={updateDraft} publishDirty={publishDirty} locale={locale} readOnly />,
    },
    {
      field: "contact_email", headerName: locale === "en" ? "Email address" : "电子邮件", minWidth: 250, editable: false,
      cellRenderer: (params: ICellRendererParams<StepRow>) => <AdminTextCell {...params} field="contact_email" updateDraft={updateDraft} publishDirty={publishDirty} locale={locale} readOnly />,
    },
    {
      field: "contact_name", headerName: locale === "en" ? "Contact Name" : "联系人姓名", minWidth: 210, editable: false,
      cellRenderer: (params: ICellRendererParams<StepRow>) => <AdminTextCell {...params} field="contact_name" updateDraft={updateDraft} publishDirty={publishDirty} locale={locale} readOnly />,
    },
    {
      colId: "actions",
      headerName: locale === "en" ? "Actions" : "操作", width: 100, minWidth: 100, maxWidth: 100,
      pinned: "right", sortable: false, filter: false, editable: false,
      cellRenderer: (params: ICellRendererParams<StepRow>) => {
        const row = params.data;
        if (!row) return null;
        return <div className="grid-row-actions">
          <button type="button" className="grid-row-action grid-row-action--update" aria-label="Edit workflow step" title="Edit workflow step" disabled={savingId === row.id || savingAll} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => {
            event.stopPropagation();
            const latest = dirtyRowsRef.current[row.id] || row;
            setStepDialogError("");
            setStepDialog({ ...latest });
          }}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>
          </button>
          <button type="button" className="grid-row-action grid-row-action--delete" aria-label="Clear assignments" title="Clear assignments" disabled={savingId === row.id || savingAll} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); const cleared = { ...row, businessEntity: null, laboratory_id: null, laboratory_code: null, laboratory_name: null, phone_number: "", contact_email: "", contact_name: "", hr_employee_id: null }; params.node.setData(cleared); markDirty(cleared); }}>
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

  function newAccessDraft(source?: AccessUserRow): AccessUserRow {
    const id = `draft-${crypto.randomUUID()}`;
    return { id, login_name: source ? `${source.login_name}-copy` : "", first_name: source?.first_name || "", last_name: source?.last_name || "", email: source?.email || "user@ionbeamtech.com", phone_number: source?.phone_number || "", company_name: source?.company_name || "", site: source?.site || "Beijing(北京)", is_active: true, created_at: "", last_sign_in: null, role_code: source?.role_code || "user", role_name: source?.role_name || "User", isDraft: true };
  }

  function openAccessDialog(mode: AccessDialogMode, source?: AccessUserRow) {
    const row = mode === "edit" && source ? { ...source } : newAccessDraft(source);
    setAccessDialogError("");
    setAccessDialogErrors({});
    setAccessDialog({ mode, row });
  }

  function updateAccessDialog(patch: Partial<AccessUserRow>) {
    setAccessDialog((current) => current ? { ...current, row: { ...current.row, ...patch } } : current);
    setAccessDialogErrors((current) => {
      const next = { ...current };
      Object.keys(patch).forEach((field) => delete next[field as AccessDialogField]);
      return next;
    });
  }

  function validateAccessDialog(row: AccessUserRow): Partial<Record<AccessDialogField, string>> {
    const errors: Partial<Record<AccessDialogField, string>> = {};
    const requiredFields: AccessDialogField[] = ["login_name", "first_name", "last_name", "email", "phone_number", "company_name", "site", "role_code"];
    requiredFields.forEach((field) => {
      if (!String(row[field] ?? "").trim()) errors[field] = locale === "en" ? "This field is required." : "此字段为必填项。";
    });
    if (row.email.trim() && !EMAIL_PATTERN.test(row.email.trim())) {
      errors.email = locale === "en" ? "Enter a valid email address." : "请输入有效的电子邮件地址。";
    }
    const country = COUNTRY_BY_SITE[normalizeSite(row.site)] || "CN";
    const phonePattern = PHONE_PATTERNS[country];
    if (row.phone_number.trim() && phonePattern && !phonePattern.test(row.phone_number.replace(/[\s()-]/g, ""))) {
      errors.phone_number = locale === "en" ? `Enter a valid ${country} phone number.` : `请输入有效的${country}电话号码。`;
    }
    return errors;
  }

  async function applyAccessDialog() {
    if (!accessDialog) return;
    const row = { ...accessDialog.row, login_name: accessDialog.row.login_name.trim() };
    const errors = validateAccessDialog(row);
    if (Object.keys(errors).length) {
      setAccessDialogErrors(errors);
      setAccessDialogError(locale === "en" ? "Please correct the highlighted fields." : "请修正高亮显示的字段。");
      return;
    }

    setAccessSaving(true);
    setAccessDialogError("");
    try {
      const body = {
        login_name: row.login_name,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        phone_number: row.phone_number,
        company_name: row.company_name,
        site: row.site,
        role_code: row.role_code,
        is_active: row.is_active,
      };
      const isNew = accessDialog.mode !== "edit" || row.isDraft;
      const response = await fetch(
        isNew
          ? "/api/v1/admin/access-management/users"
          : `/api/v1/admin/access-management/users/${row.id}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-Orbit-Auth": localStorage.getItem("orbit:auth-token") || "",
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || `HTTP ${response.status}`);
      }

      const refreshed = await fetch(
        `/api/v1/admin/access-management?locale=${locale}`,
        { headers: { "X-Orbit-Auth": localStorage.getItem("orbit:auth-token") || "" } },
      );
      if (!refreshed.ok) throw new Error(`HTTP ${refreshed.status}`);
      const nextAccess = await refreshed.json() as AccessResponse;

      // Keep unrelated grid edits pending, but remove the row just persisted.
      const pendingRows = Object.values(accessDirtyRows).filter(
        (pending) => pending.id !== row.id && !nextAccess.users.some((item) => item.id === pending.id),
      );
      setAccessDirtyRows((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      setAccess({ ...nextAccess, users: [...pendingRows, ...nextAccess.users] });
      setAccessDialog(null);
      setAccessDialogErrors({});
    } catch (reason) {
      setAccessDialogError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAccessSaving(false);
    }
  }

  function addAccessRow(source?: AccessUserRow) {
    openAccessDialog(source ? "copy" : "add", source);
  }

  function closeAccessDialog() {
    setAccessDialog(null);
    setAccessDialogError("");
    setAccessDialogErrors({});
  }

  function accessDialogLabel(field: string) {
    const labels: Record<string, string> = { login_name: "Login", first_name: "First name", last_name: "Last name", email: "Email", phone_number: "Phone", company_name: "Company", site: "Site" };
    return locale === "en" ? labels[field] : ({ login_name: "登录名", first_name: "名", last_name: "姓", email: "电子邮件", phone_number: "电话", company_name: "公司", site: "站点" }[field] || labels[field]);
  }

  function accessDialogInput(field: Exclude<AccessDialogField, "role_code">) {
    if (!accessDialog) return null;
    const value = accessDialog.row[field];
    const readOnly = field === "login_name" && accessDialog.mode === "edit";
    return <label key={field} className="grid-edit-field">
      <span>{accessDialogLabel(field)}<b className="grid-edit-field__required" aria-label="required">*</b></span>
      {field === "site" ? <select value={normalizeSite(value)} aria-invalid={Boolean(accessDialogErrors[field])} aria-describedby={accessDialogErrors[field] ? `${field}-error` : undefined} onChange={(event) => updateAccessDialog({ site: event.target.value })} disabled={accessSaving}>
        {GEOLOCATION_SITES.map((site) => <option key={site.id} value={site.value}>{locale === "en" ? `${site.name} (${site.name_zh})` : site.value}</option>)}
      </select> : <input type={field === "email" ? "email" : field === "phone_number" ? "tel" : "text"} value={value} readOnly={readOnly} required aria-invalid={Boolean(accessDialogErrors[field])} aria-describedby={accessDialogErrors[field] ? `${field}-error` : undefined} onChange={(event) => updateAccessDialog({ [field]: event.target.value })} disabled={accessSaving} />}
      {accessDialogErrors[field] ? <small id={`${field}-error`} className="grid-edit-field__error">{accessDialogErrors[field]}</small> : null}
    </label>;
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
        const response = await fetch(row.isDraft ? "/api/v1/admin/access-management/users" : `/api/v1/admin/access-management/users/${row.id}`, { method: row.isDraft ? "POST" : "PATCH", headers: { "Content-Type": "application/json", "X-Orbit-Auth": localStorage.getItem("orbit:auth-token") || "" }, body: JSON.stringify(row.isDraft ? body : { ...body, login_name: row.login_name, first_name: row.first_name, last_name: row.last_name, email: row.email, phone_number: row.phone_number, company_name: row.company_name, site: row.site }) });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `HTTP ${response.status}`);
      }
      const refreshed = await fetch(`/api/v1/admin/access-management?locale=${locale}`, { headers: { "X-Orbit-Auth": localStorage.getItem("orbit:auth-token") || "" } });
      if (!refreshed.ok) throw new Error(`HTTP ${refreshed.status}`);
      setAccess(await refreshed.json() as AccessResponse); setAccessDirtyRows({}); setAccessDeletedIds([]); setAccessDialog(null);
    } catch (reason) { setAccessError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setAccessSaving(false); }
  }

  const accessColumns = useMemo<ColDef<AccessUserRow>[]>(() => [
    { field: "login_name", headerName: locale === "en" ? "Login" : "登录名", minWidth: 110, flex: 1, pinned: "left", enableRowGroup: true },
    { field: "first_name", headerName: locale === "en" ? "First name" : "名", minWidth: 95, flex: 1 },
    { field: "last_name", headerName: locale === "en" ? "Last name" : "姓", minWidth: 95, flex: 1 },
    { field: "email", headerName: locale === "en" ? "Email" : "电子邮件", minWidth: 150, flex: 1.4 },
    { field: "phone_number", headerName: locale === "en" ? "Phone" : "电话", minWidth: 110, flex: 1 },
    { field: "company_name", headerName: locale === "en" ? "Company" : "公司", minWidth: 105, flex: 1 },
    { field: "site", headerName: locale === "en" ? "Site" : "站点", minWidth: 105, flex: 1 },
    {
      field: "role_code", headerName: locale === "en" ? "Access role" : "访问角色", minWidth: 100, flex: 1, editable: false,
      valueFormatter: (params) => access?.roles.find((role) => role.code === params.value)?.name || params.value || "—",
    },
    {
      field: "is_active", headerName: locale === "en" ? "Active" : "启用", minWidth: 70, flex: 0.7, editable: false,
      cellRenderer: (params: ICellRendererParams<AccessUserRow>) => params.data ? <input type="checkbox" checked={params.data.is_active} aria-label={`${params.data.login_name} active`} readOnly /> : null,
    },
    { field: "last_sign_in", headerName: locale === "en" ? "Last sign-in" : "最后登录", minWidth: 120, flex: 1.2, valueFormatter: (params) => params.value ? new Date(params.value).toLocaleString(locale === "en" ? "en-US" : "zh-CN") : "—" },
    { field: "created_at", headerName: locale === "en" ? "Signed up" : "注册时间", minWidth: 120, flex: 1.2, valueFormatter: (params) => params.value ? new Date(params.value).toLocaleString(locale === "en" ? "en-US" : "zh-CN") : "—" },
    { colId: "actions", headerName: locale === "en" ? "Actions" : "操作", pinned: "right", width: 108, minWidth: 108, maxWidth: 108, sortable: false, filter: false, cellRenderer: (params: ICellRendererParams<AccessUserRow>) => params.data ? <div className="grid-row-actions">
      <button type="button" className="grid-row-action grid-row-action--edit" title="Edit row" aria-label="Edit row" onMouseDown={(event) => event.stopPropagation()} onClick={() => openAccessDialog("edit", params.data)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 16-.8 4.8L8 20 18.8 9.2l-4-4L4 16Zm9.4-9.4 4 4" /></svg></button>
      <button type="button" className="grid-row-action grid-row-action--duplicate" title="Copy row" aria-label="Copy row" onMouseDown={(event) => event.stopPropagation()} onClick={() => addAccessRow(params.data)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 8h11v11H8zM5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1" /></svg></button>
      <button type="button" className="grid-row-action grid-row-action--delete" title="Delete row" aria-label="Delete row" onMouseDown={(event) => event.stopPropagation()} onClick={() => deleteAccessRow(params.data!)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M10 11v6m4-6v6M9 7V4h6v3m-9 0 1 13h8l1-13" /></svg></button>
    </div> : null },
  ], [access?.roles, locale]);

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
        {accessDialog ? <div className="dialog-backdrop grid-edit-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAccessDialog(); }}>
          <section className="dialog-surface grid-edit-dialog access-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="access-edit-title">
            <header className="grid-edit-dialog__header">
              <div>
                <span className="confirm-dialog__eyebrow">ACCESS MANAGEMENT</span>
                <h2 id="access-edit-title">{accessDialog.mode === "edit" ? (locale === "en" ? "Edit account" : "编辑账户") : accessDialog.mode === "copy" ? (locale === "en" ? "Copy account" : "复制账户") : (locale === "en" ? "Add account" : "新增账户")}</h2>
              </div>
              <button type="button" className="grid-edit-dialog__close" aria-label={locale === "en" ? "Close" : "关闭"} onClick={closeAccessDialog} disabled={accessSaving}><svg className="grid-edit-action__icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
            </header>
            <div className="grid-edit-dialog__body">
              {(["login_name", "first_name", "last_name", "email", "phone_number", "company_name", "site"] as const).map((field) => accessDialogInput(field))}
              <label className="grid-edit-field"><span>{locale === "en" ? "Access role" : "访问角色"}<b className="grid-edit-field__required" aria-label="required">*</b></span><select value={accessDialog.row.role_code} required aria-invalid={Boolean(accessDialogErrors.role_code)} aria-describedby={accessDialogErrors.role_code ? "role_code-error" : undefined} onChange={(event) => updateAccessDialog({ role_code: event.target.value, role_name: access?.roles.find((role) => role.code === event.target.value)?.name || event.target.value })} disabled={accessSaving}>{(access?.roles || []).map((role) => <option key={role.code} value={role.code}>{role.name}</option>)}</select>{accessDialogErrors.role_code ? <small id="role_code-error" className="grid-edit-field__error">{accessDialogErrors.role_code}</small> : null}</label>
              <label className="grid-edit-field"><span>{locale === "en" ? "Active" : "启用"}</span><input type="checkbox" checked={accessDialog.row.is_active} onChange={(event) => updateAccessDialog({ is_active: event.target.checked })} disabled={accessSaving} /></label>
            </div>
            {accessDialogError ? <p className="grid-edit-dialog__error" role="alert">{accessDialogError}</p> : null}
            <footer className="dialog-actions grid-edit-dialog__actions">
              <button type="button" className="confirm-dialog__cancel" onClick={closeAccessDialog} disabled={accessSaving}><svg className="grid-edit-action__icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M6 6l12 12M18 6 6 18" /></svg>{locale === "en" ? "Cancel" : "取消"}</button>
              <button type="button" className="confirm-dialog__confirm" onClick={() => void applyAccessDialog()} disabled={accessSaving}><svg className="grid-edit-action__icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="m5 12 4 4L19 6" /></svg>{accessSaving ? (locale === "en" ? "Saving…" : "保存中…") : (locale === "en" ? "Apply" : "应用")}</button>
            </footer>
          </section>
        </div> : null}
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
          <div className="system-config-grid-toolbar"><button type="button" className="grid-layout-reset-button" aria-label={locale === "en" ? "Reset grid settings" : "重置表格设置"} title={locale === "en" ? "Reset grid settings" : "重置表格设置"} onClick={resetWorkflowGrid}>{locale === "en" ? "Reset grid" : locale === "zh-HK" ? "重置表格" : "重置表格"}</button></div>
          <div className="system-config-grid grid-frame" aria-busy={loading}><AgGridReact<StepRow> key={`${workflowKey}-${locale}-${theme}`} theme={theme === "navy" ? orbitGridNavyTheme : theme === "light" ? orbitGridTheme : theme === "black" ? orbitGridBlackTheme : orbitGridGreenTheme} rowData={config?.steps || []} columnDefs={columns} defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, suppressHeaderMenuButton: false }} stopEditingWhenCellsLoseFocus rowHeight={44} headerHeight={46} floatingFiltersHeight={34} enableBrowserTooltips ensureDomOrder suppressAnimationFrame alwaysShowHorizontalScroll onGridReady={(event) => { gridApiRef.current = event.api; }} onCellValueChanged={(event) => { if (event.data) markDirty(event.data); }} /></div>
          {stepDialog ? <div className="dialog-backdrop grid-edit-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStepDialog(null); }}>
            <section className="dialog-surface grid-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="workflow-step-edit-title">
              <header className="grid-edit-dialog__header">
                <div>
                  <span className="confirm-dialog__eyebrow">WORKFLOW STEP</span>
                  <h2 id="workflow-step-edit-title">{locale === "en" ? "Edit workflow step" : "编辑工作流步骤"}</h2>
                </div>
                <button type="button" className="grid-edit-dialog__close" aria-label={locale === "en" ? "Close" : "关闭"} onClick={() => setStepDialog(null)} disabled={Boolean(savingId)}><svg className="grid-edit-action__icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
              </header>
              <div className="grid-edit-dialog__body">
                <label className="grid-edit-field"><span>SLA</span><input type="text" value={stepDialog.sla || ""} placeholder="—" onChange={(event) => updateStepDialog({ sla: event.target.value || null })} disabled={Boolean(savingId)} /></label>
                <label className="grid-edit-field"><span>Business entity</span><select value={stepDialog.businessEntity || ""} onChange={(event) => updateStepDialog({ businessEntity: event.target.value || null })} disabled={Boolean(savingId)}><option value="">{locale === "en" ? "Select business entity" : "选择业务实体"}</option>{(config?.businessEntities || []).map((entity) => <option key={entity.key} value={entity.name}>{entity.name}</option>)}</select></label>
                <label className="grid-edit-field"><span>{locale === "en" ? "Laboratory" : "实验室"}</span><select value={stepDialog.laboratory_id || ""} onChange={(event) => { const laboratoryId = event.target.value || null; const laboratory = config?.laboratories.find((item) => item.id === laboratoryId); updateStepDialog({ laboratory_id: laboratoryId, laboratory_name: laboratory?.name || null, laboratory_code: laboratory?.code || null }); }} disabled={Boolean(savingId)}><option value="">{locale === "en" ? "Select laboratory" : "选择实验室"}</option>{(config?.laboratories || []).map((laboratory) => <option key={laboratory.id} value={laboratory.id}>{laboratory.name}</option>)}</select></label>
                <label className="grid-edit-field"><span>{locale === "en" ? "Phone Number" : "电话号码"}</span><input type="tel" value={stepDialog.phone_number} onChange={(event) => updateStepDialog({ phone_number: event.target.value })} disabled={Boolean(savingId)} /></label>
                <label className="grid-edit-field"><span>{locale === "en" ? "Email address" : "电子邮件"}</span><input type="email" value={stepDialog.contact_email} onChange={(event) => updateStepDialog({ contact_email: event.target.value })} disabled={Boolean(savingId)} /></label>
                <label className="grid-edit-field"><span>{locale === "en" ? "Contact Name" : "联系人姓名"}</span><input type="text" value={stepDialog.contact_name} onChange={(event) => updateStepDialog({ contact_name: event.target.value })} disabled={Boolean(savingId)} /></label>
              </div>
              {stepDialogError ? <p className="grid-edit-dialog__error" role="alert">{stepDialogError}</p> : null}
              <footer className="dialog-actions grid-edit-dialog__actions"><button type="button" className="confirm-dialog__cancel" onClick={() => setStepDialog(null)} disabled={Boolean(savingId)}><svg className="grid-edit-action__icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M6 6l12 12M18 6 6 18" /></svg>{locale === "en" ? "Cancel" : "取消"}</button><button type="button" className="confirm-dialog__confirm" onClick={() => void applyStepDialog()} disabled={Boolean(savingId)}><svg className="grid-edit-action__icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="m5 12 4 4L19 6" /></svg>{savingId ? (locale === "en" ? "Saving…" : "保存中…") : (locale === "en" ? "Save" : "保存")}</button></footer>
            </section>
          </div> : null}
        </div> : <div className="system-config-workflow-empty">{locale === "en" ? "Select a workflow panel to view its steps." : "请选择一个工作流面板查看步骤。"}</div>}
      </section> : null}
    </section>
  </main>;
}
