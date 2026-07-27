import { useEffect, useMemo, useState } from "react";
import { themeQuartz, type ColDef, type ValueGetterParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";

import {
  useGetGeolocationQuery,
  useGetHealthQuery,
  useCreateRecordMutation,
  useDeleteRecordMutation,
  useGetRecordsQuery,
  useGetSessionQuery,
  useGetWorkflowQuery,
  useGetWorkflowTreeQuery,
  useGetWorkflowRuntimeQuery,
  useGetWorkflowsQuery,
  useUpdateRecordMutation,
  useWorkflowCommandMutation,
  useAppendWorkflowStepMessageMutation,
} from "../app/orbitApi";
import { useAppSelector } from "../app/store";
import { AuthDialog } from "../components/AuthDialog";
import { MailComposeDialog } from "../components/MailComposeDialog";
import { WorkflowCascade } from "../components/WorkflowCascade";
import { WorkflowMessageDialog } from "../components/WorkflowMessageDialog";
import { WorkflowReportDialog } from "../components/WorkflowReportDialog";
import type { Locale, SessionInfo, ThemeMode, WorkflowCommandInput, WorkflowDetail, WorkflowRecord, WorkflowRuntimeProjection, WorkflowSummary, WorkflowTree } from "../types";

type MobilityRoute = "home" | "workflows" | "account";

const mobileGridTheme = themeQuartz.withParams({
  accentColor: "#1f6fc2",
  backgroundColor: "#ffffff",
  foregroundColor: "#1a2233",
  borderColor: "#cdd5e0",
  headerBackgroundColor: "#1f5fa0",
  headerTextColor: "#ffffff",
  oddRowBackgroundColor: "#f4f7fb",
  rowHoverColor: "#e2eaf3",
  fontFamily: "IBM Plex Sans, Noto Sans SC, sans-serif",
  fontSize: 12,
  spacing: 5,
  borderRadius: 0,
  wrapperBorderRadius: 0,
});

export function MobilityApp() {
  const locale = useAppSelector((state) => state.workspace.locale);
  const [route, setRoute] = useState<MobilityRoute>(() => normalizeRoute(window.location.pathname));
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("orbit:auth-token"));
  const [authOpen, setAuthOpen] = useState(() => !localStorage.getItem("orbit:auth-token"));

  const sessionQuery = useGetSessionQuery(locale, { skip: !authToken });
  const healthQuery = useGetHealthQuery(undefined, { skip: !authToken });
  const workflowsQuery = useGetWorkflowsQuery(locale, { skip: !authToken });
  const geolocationQuery = useGetGeolocationQuery();

  useEffect(() => {
    document.body.classList.add("mobility-body");
    document.documentElement.lang = locale;
    document.title = locale === "en" ? "Orbit Mobility" : "Orbit 移动端";
    return () => document.body.classList.remove("mobility-body");
  }, [locale]);

  useEffect(() => {
    const onPopState = () => setRoute(normalizeRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!authToken || !sessionQuery.isError) return;
    localStorage.removeItem("orbit:auth-token");
    setAuthToken(null);
    setAuthOpen(true);
    setRoute("home");
  }, [authToken, sessionQuery.isError]);

  const text = useMemo(() => copyFor(locale), [locale]);
  const signedIn = Boolean(authToken && sessionQuery.data);
  const workflows = workflowsQuery.data ?? [];
  const recordCount = workflows.reduce((total, workflow) => total + workflow.record_count, 0);

  function navigateTo(nextRoute: MobilityRoute) {
    const nextPath = nextRoute === "home" ? "/mobility" : `/mobility/${nextRoute}`;
    window.history.pushState(null, "", nextPath);
    setRoute(nextRoute);
  }

  function handleSignedIn(_user: unknown, token: string) {
    localStorage.setItem("orbit:auth-token", token);
    setAuthToken(token);
    setAuthOpen(false);
    navigateTo("home");
  }

  function signOut() {
    localStorage.removeItem("orbit:auth-token");
    setAuthToken(null);
    setAuthOpen(false);
    navigateTo("home");
  }

  return (
    <div className="mobility-shell">
      <header className="mobility-header">
        <div className="mobility-brand">
          <span className="mobility-brand__mark">O</span>
          <div><span className="mobility-brand__eyebrow">ORBIT AUTOMATION</span><strong>{text.title}</strong></div>
        </div>
        <div className="mobility-header__status">
          <span className={`mobility-status-dot${healthQuery.data?.status === "ok" ? " is-online" : ""}`} />
          <span>{healthQuery.data?.status === "ok" ? text.online : text.connecting}</span>
        </div>
      </header>

      <main className="mobility-main">
        {!signedIn ? (
          <WelcomePanel text={text} onSignIn={() => setAuthOpen(true)} />
        ) : route === "workflows" ? (
          <WorkflowList workflows={workflows} text={text} />
        ) : route === "account" ? (
          <AccountPanel session={sessionQuery.data} catalog={geolocationQuery.data} text={text} onSignOut={signOut} />
        ) : (
          <HomePanel
            session={sessionQuery.data}
            workflowCount={workflows.length}
            recordCount={recordCount}
            siteCount={geolocationQuery.data?.sites.length ?? 0}
            text={text}
            loading={workflowsQuery.isLoading}
            onOpenWorkflows={() => navigateTo("workflows")}
            onOpenAccount={() => navigateTo("account")}
          />
        )}
      </main>

      <nav className="mobility-nav" aria-label={text.navigation}>
        {([["home", "⌂", text.home], ["workflows", "▤", text.workflows], ["account", "◎", text.account]] as const).map(([key, icon, label]) => (
          <button key={key} type="button" className={route === key ? "is-active" : ""} onClick={() => navigateTo(key)} disabled={!signedIn}>
            <span aria-hidden="true">{icon}</span>{label}
          </button>
        ))}
      </nav>

      <AuthDialog open={authOpen} locale={locale} onClose={() => setAuthOpen(false)} onSignedIn={handleSignedIn} />
    </div>
  );
}

function WelcomePanel({ text, onSignIn }: { text: MobilityCopy; onSignIn: () => void }) {
  return <section className="mobility-card mobility-card--welcome">
    <span className="mobility-kicker">{text.secureAccess}</span>
    <h1>{text.welcome}</h1>
    <p>{text.welcomeCopy}</p>
    <button className="mobility-button mobility-button--primary" type="button" onClick={onSignIn}>{text.signIn}<span aria-hidden="true">→</span></button>
    <div className="mobility-trust-row"><span>✓ {text.mobileReady}</span><span>✓ {text.liveData}</span></div>
  </section>;
}

function HomePanel({ session, workflowCount, recordCount, siteCount, text, loading, onOpenWorkflows, onOpenAccount }: {
  session: SessionInfo | undefined; workflowCount: number; recordCount: number; siteCount: number; text: MobilityCopy;
  loading: boolean; onOpenWorkflows: () => void; onOpenAccount: () => void;
}) {
  const displayName = session?.display_name ?? session?.login_name ?? "Orbit";
  return <div className="mobility-stack">
    <section className="mobility-card mobility-card--hero">
      <span className="mobility-kicker">{text.today}</span>
      <h1>{text.goodMorning}, {displayName}</h1>
      <p>{text.dashboardCopy}</p>
      <div className="mobility-scope"><span className="mobility-scope__icon">⌁</span><div><span>{text.organization}</span><strong>{session?.scope.organization_name ?? "—"}</strong></div></div>
    </section>
    <section className="mobility-metric-grid" aria-label={text.summary}>
      <Metric label={text.workflows} value={loading ? "—" : String(workflowCount)} tone="blue" />
      <Metric label={text.records} value={loading ? "—" : String(recordCount)} tone="green" />
      <Metric label={text.sites} value={String(siteCount)} tone="orange" />
    </section>
    <section className="mobility-card">
      <div className="mobility-card__heading"><div><span className="mobility-kicker">{text.workspace}</span><h2>{text.quickAccess}</h2></div><span className="mobility-heading-icon">↗</span></div>
      <div className="mobility-action-list">
        <button type="button" onClick={onOpenWorkflows}><span className="mobility-action-icon mobility-action-icon--blue">▤</span><span><strong>{text.browseWorkflows}</strong><small>{text.browseWorkflowsCopy}</small></span><b>›</b></button>
        <button type="button" onClick={onOpenAccount}><span className="mobility-action-icon mobility-action-icon--green">◎</span><span><strong>{text.accountDetails}</strong><small>{text.accountDetailsCopy}</small></span><b>›</b></button>
      </div>
    </section>
  </div>;
}

function WorkflowList({ workflows, text }: { workflows: WorkflowSummary[]; text: MobilityCopy }) {
  const [search, setSearch] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("sales");
  const [selectedWorkflowKey, setSelectedWorkflowKey] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"insert" | "edit" | null>(null);
  const [editorValues, setEditorValues] = useState<Record<string, unknown>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const locale = useAppSelector((state) => state.workspace.locale);
  const theme = useAppSelector((state) => state.workspace.theme);
  const catalogWorkflows = useMemo(() => workflows.filter((workflow) =>
    !workflow.is_master && workflow.definition_type === "workflow" &&
    (selectedGroup === "hr" ? workflow.group_key === "hr" : workflow.group_key !== "hr"),
  ), [selectedGroup, workflows]);
  useEffect(() => {
    if (!selectedWorkflowKey && catalogWorkflows.length > 0) {
      setSelectedWorkflowKey(catalogWorkflows[0]?.key || null);
    }
  }, [catalogWorkflows, selectedWorkflowKey]);
  const workflowQuery = useGetWorkflowQuery({ workflowKey: selectedWorkflowKey || "", locale }, { skip: !selectedWorkflowKey });
  const recordsQuery = useGetRecordsQuery({
    workflowKey: selectedWorkflowKey || "",
    locale,
    search,
    sortBy: "record_order",
    sortDirection: "asc",
  }, { skip: !selectedWorkflowKey });
  const treeQuery = useGetWorkflowTreeQuery({
    workflowKey: selectedWorkflowKey || "",
    locale,
    recordId: selectedRecordId,
    cellKey: null,
    stepKey: null,
  }, { skip: !selectedWorkflowKey || !selectedRecordId });
  const runtimeQuery = useGetWorkflowRuntimeQuery({ instanceId: selectedRecordId || "", workflowKey: selectedWorkflowKey || "" }, { skip: !selectedWorkflowKey || !selectedRecordId });
  const [createRecord, createState] = useCreateRecordMutation();
  const [updateRecord, updateState] = useUpdateRecordMutation();
  const [deleteRecord, deleteState] = useDeleteRecordMutation();
  const [sendWorkflowCommand, commandState] = useWorkflowCommandMutation();
  const [appendWorkflowStepMessage, messageState] = useAppendWorkflowStepMessageMutation();
  const selectedRecord = useMemo(
    () => recordsQuery.data?.items.find((record) => (record.tree_record_id || record.id) === selectedRecordId),
    [recordsQuery.data?.items, selectedRecordId],
  );
  const editableColumns = workflowQuery.data?.columns.filter((column) => column.editable) || [];
  const actionBusy = createState.isLoading || updateState.isLoading || deleteState.isLoading;

  async function handleWorkflowCommand(command: WorkflowCommandInput): Promise<void> {
    const instanceId = runtimeQuery.data?.instance.id || selectedRecordId;
    if (!instanceId) return;
    await sendWorkflowCommand({ instanceId, ...command }).unwrap();
    await Promise.all([runtimeQuery.refetch(), treeQuery.refetch()]);
  }

  async function handleSaveWorkflowMessage(recordId: string, message: string): Promise<void> {
    if (!selectedWorkflowKey) return;
    await appendWorkflowStepMessage({ workflowKey: selectedWorkflowKey, recordId, message, locale }).unwrap();
    await treeQuery.refetch();
  }

  function startEditor(mode: "insert" | "edit") {
    if (mode === "edit" && !selectedRecord) return;
    setActionError(null);
    setEditorMode(mode);
    setEditorValues(mode === "edit" ? { ...(selectedRecord?.values || {}) } : {});
  }

  async function saveEditor() {
    if (!selectedWorkflowKey) return;
    try {
      setActionError(null);
      if (editorMode === "edit" && selectedRecord) {
        await updateRecord({ workflowKey: selectedWorkflowKey, recordId: selectedRecord.id, values: editorValues, version: selectedRecord.version, locale }).unwrap();
      } else if (editorMode === "insert") {
        await createRecord({ workflowKey: selectedWorkflowKey, values: editorValues, locale }).unwrap();
      }
      setEditorMode(null);
      await recordsQuery.refetch();
    } catch (error) {
      setActionError(readMutationError(error));
    }
  }

  async function duplicateSelected() {
    if (!selectedWorkflowKey || !selectedRecord) return;
    try {
      setActionError(null);
      const values = { ...selectedRecord.values };
      if ("order_number" in values) values.order_number = "";
      await createRecord({ workflowKey: selectedWorkflowKey, values, locale }).unwrap();
      await recordsQuery.refetch();
    } catch (error) {
      setActionError(readMutationError(error));
    }
  }

  async function deleteSelected() {
    if (!selectedWorkflowKey || !selectedRecord) return;
    if (!window.confirm(text.confirmDelete)) return;
    try {
      setActionError(null);
      await deleteRecord({ workflowKey: selectedWorkflowKey, recordId: selectedRecord.id }).unwrap();
      setSelectedRecordId(null);
      await recordsQuery.refetch();
    } catch (error) {
      setActionError(readMutationError(error));
    }
  }
  return <div className="mobility-stack">
    <section className="mobility-card mobility-grid-card">
      <div className="mobility-grid-card__heading">
        <div><span className="mobility-kicker">{text.selectWorkflow}</span><strong>{text.workflowGridCopy}</strong></div>
        {selectedWorkflowKey ? <button type="button" onClick={() => { setSelectedWorkflowKey(null); setSelectedRecordId(null); }}>{text.backToWorkflows}</button> : null}
      </div>
      <div className="mobility-catalog">
        <WorkflowCascade
          locale={locale}
          workflows={workflows}
          selectedGroup={selectedGroup}
          selectedWorkflow={selectedWorkflowKey || ""}
          onGroupSelect={(group) => {
            const nextGroup = group === "people-operations" ? "hr" : "sales";
            setSelectedGroup(nextGroup);
            setSelectedRecordId(null);
            const first = workflows.find((workflow) =>
              !workflow.is_master && workflow.definition_type === "workflow" &&
              (nextGroup === "hr" ? workflow.group_key === "hr" : workflow.group_key !== "hr"),
            );
            setSelectedWorkflowKey(first?.key || null);
          }}
          onWorkflowSelect={(workflowKey) => {
            const selected = workflows.find((workflow) => workflow.key === workflowKey);
            if (selected) setSelectedGroup(selected.group_key === "hr" ? "hr" : "sales");
            setSelectedWorkflowKey(workflowKey);
            setSelectedRecordId(null);
          }}
        />
      </div>
    </section>
    {selectedWorkflowKey ? (
      <section className="mobility-card mobility-data-card">
        <div className="mobility-card__heading"><div><span className="mobility-kicker">{text.dataRows}</span><h2>{workflowQuery.data?.name || selectedWorkflowKey}</h2></div><span className="mobility-grid-count">{recordsQuery.data?.total ?? 0}</span></div>
        <p className="mobility-grid-hint">{text.selectRow}</p>
        <div className="mobility-grid-toolbar"><label className="mobility-grid-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={text.searchRecords} /></label></div>
        <div className="mobility-record-actions">
          <button type="button" disabled={!workflowQuery.data?.access.can_edit || actionBusy} onClick={() => startEditor("insert")}>{text.insert}</button>
          <button type="button" disabled={!workflowQuery.data?.access.can_edit || !selectedRecord || actionBusy} onClick={() => startEditor("edit")}>{text.edit}</button>
          <button type="button" className="is-danger" disabled={!workflowQuery.data?.access.can_edit || !selectedRecord || actionBusy} onClick={() => void deleteSelected()}>{text.delete}</button>
          <button type="button" disabled={!workflowQuery.data?.access.can_edit || !selectedRecord || actionBusy} onClick={() => void duplicateSelected()}>{text.duplicate}</button>
          <button type="button" disabled={!editorMode && !actionError} onClick={() => { setEditorMode(null); setActionError(null); }}>{text.cancel}</button>
        </div>
        {actionError ? <p className="mobility-action-error" role="alert">{actionError}</p> : null}
        {editorMode ? <MobileRecordEditor columns={editableColumns} values={editorValues} mode={editorMode} busy={actionBusy} text={text} onChange={(key, value) => setEditorValues((current) => ({ ...current, [key]: value }))} onSave={() => void saveEditor()} onCancel={() => setEditorMode(null)} /> : null}
        <WorkflowRecordsGrid detail={workflowQuery.data} records={recordsQuery.data?.items || []} loading={recordsQuery.isLoading} selectedRecordId={selectedRecordId} onSelect={(record) => setSelectedRecordId(record.tree_record_id || record.id)} text={text} />
      </section>
    ) : null}
    {selectedWorkflowKey && selectedRecordId ? <WorkflowSteps tree={treeQuery.data} runtime={runtimeQuery.data} loading={treeQuery.isLoading || runtimeQuery.isLoading} text={text} locale={locale} theme={"navy"} commandBusy={commandState.isLoading} messageBusy={messageState.isLoading} onCommand={handleWorkflowCommand} onSaveMessage={handleSaveWorkflowMessage} onRefresh={async () => { await Promise.all([runtimeQuery.refetch(), treeQuery.refetch()]); }} /> : null}
  </div>;
}

function WorkflowRecordsGrid({ detail, records, loading, selectedRecordId, onSelect, text }: { detail: WorkflowDetail | undefined; records: WorkflowRecord[]; loading: boolean; selectedRecordId: string | null; onSelect: (record: WorkflowRecord) => void; text: MobilityCopy }) {
  const columnDefs = useMemo<ColDef<WorkflowRecord>[]>(() => [
    { field: "label", headerName: text.record, minWidth: 175, pinned: "left" },
    ...(detail?.columns || []).map((column) => ({
      colId: column.key,
      headerName: column.label,
      minWidth: 145,
      valueGetter: (params: ValueGetterParams<WorkflowRecord>) => displayValue(params.data?.values[column.key]),
    })),
  ], [detail?.columns, text]);

  return <div className="mobility-grid-wrap mobility-records-grid" aria-busy={loading}>
    <AgGridReact<WorkflowRecord>
      theme={mobileGridTheme}
      rowData={records}
      columnDefs={columnDefs}
      defaultColDef={{ sortable: true, resizable: true, filter: true }}
      getRowId={(params) => params.data.id}
      rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }}
      onRowClicked={(event) => { if (event.data) onSelect(event.data); }}
      rowClassRules={{ "mobility-grid-row-selected": (params) => Boolean(selectedRecordId && (params.data?.tree_record_id || params.data?.id) === selectedRecordId) }}
      rowHeight={42}
      headerHeight={38}
      domLayout="autoHeight"
      pagination
      paginationPageSize={6}
    />
  </div>;
}

function WorkflowSteps({ tree, runtime, loading, text, locale, theme, commandBusy, messageBusy, onCommand, onSaveMessage, onRefresh }: { tree: WorkflowTree | undefined; runtime: WorkflowRuntimeProjection | undefined; loading: boolean; text: MobilityCopy; locale: Locale; theme: ThemeMode; commandBusy: boolean; messageBusy: boolean; onCommand: (command: WorkflowCommandInput) => Promise<void>; onSaveMessage: (recordId: string, message: string) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [mailBody, setMailBody] = useState("");
  const explicitCurrentIndex = tree?.nodes.findIndex((node) => node.is_selected) ?? -1;
  const currentIndex = explicitCurrentIndex >= 0 ? explicitCurrentIndex : tree?.nodes.length ? 0 : -1;
  const currentTreeNode = tree?.nodes[currentIndex];
  const currentRuntimeNode = runtime?.nodes.find((node) => node.record_key === currentTreeNode?.record_key);
  const showActions = Boolean(currentTreeNode && currentRuntimeNode && currentRuntimeNode.record_key === runtime?.instance.current_record_key);
  async function send(command: string): Promise<void> {
    if (!currentRuntimeNode || !runtime) return;
    await onCommand({ command, nodeKey: currentRuntimeNode.record_key, version: runtime.instance.version });
  }
  return <section className="mobility-card mobility-steps-card" aria-busy={loading}>
    <div className="mobility-card__heading"><div><span className="mobility-kicker">{text.steps}</span><h2>{tree?.workflow_name || text.steps}</h2></div><span className="mobility-grid-count">{tree?.nodes.length || 0}</span></div>
    {loading ? <p className="mobility-empty">{text.loading}</p> : tree?.nodes.length ? <ol className="mobility-steps-list">{tree.nodes.map((node, index) => {
      const isCurrent = index === currentIndex;
      const isComplete = explicitCurrentIndex >= 0 ? node.is_before_selected : index < currentIndex;
      return <li key={node.record_key} className={isCurrent ? "is-current" : isComplete ? "is-complete" : ""}><span>{String(node.order).padStart(2, "0")}</span><div><strong>{node.label}</strong><small>{isCurrent ? text.current : isComplete ? text.completed : text.upcoming}{node.owner_role ? ` · ${node.owner_role}` : ""}</small>{isCurrent && showActions ? <div className="mobility-workflow-actions">
        <label className="mobility-workflow-check"><input type="checkbox" checked={currentRuntimeNode?.status === "completed"} disabled={commandBusy || currentRuntimeNode?.status === "completed" || currentTreeNode?.DocumentAction !== null} onChange={() => void send("submit")} /><span>{locale === "en" ? "Done" : "完成"}</span></label>
        {currentTreeNode?.business_entity && currentTreeNode.DocumentAction !== null ? <label className="mobility-workflow-action-check" title={locale === "en" ? "Action document" : "动作文档"}><input type="checkbox" checked={currentTreeNode.DocumentAction === true} disabled={commandBusy || currentTreeNode.DocumentAction === true} onChange={() => setReportOpen(true)} />{currentTreeNode.DocumentAction === false ? <b aria-hidden="true">*</b> : null}</label> : null}
        <button type="button" className="mobility-workflow-icon" title={locale === "en" ? "Add message" : "添加消息"} aria-label={locale === "en" ? "Add message" : "添加消息"} disabled={commandBusy || messageBusy} onClick={() => setMessageOpen(true)}>✎</button>
        <button type="button" className="mobility-workflow-icon" title={locale === "en" ? "Email" : "电子邮件"} aria-label={locale === "en" ? "Email" : "电子邮件"} disabled={commandBusy} onClick={() => { setMailBody(""); setMailOpen(true); }}>✉</button>
        <button type="button" className="mobility-workflow-icon" title={locale === "en" ? "Contact" : "联系人"} aria-label={locale === "en" ? "Contact" : "联系人"} disabled={commandBusy} onClick={() => { setMailBody(currentTreeNode?.ContactName?.trim() ? `DEAR ${currentTreeNode.ContactName.trim()}` : "DEAR"); setMailOpen(true); }}>♙</button>
        <button type="button" className="mobility-workflow-about" disabled={commandBusy} onClick={() => void send("abort")}>{locale === "en" ? "About" : "关于"}</button>
      </div> : null}</div></li>;
    })}</ol> : <p className="mobility-empty">{text.noSteps}</p>}
    {currentTreeNode && currentRuntimeNode ? <>
      {mailOpen ? <MailComposeDialog locale={locale} defaultTo={currentTreeNode.Email || ""} defaultBody={mailBody} defaultSubject={`${locale === "en" ? "Email" : "电子邮件"} · ${currentTreeNode.record_key}`} onClose={() => setMailOpen(false)} /> : null}
      {messageOpen ? <WorkflowMessageDialog locale={locale} messages={currentTreeNode.Messages || []} busy={messageBusy} onSave={(message) => onSaveMessage(currentTreeNode.record_key, message)} onClose={() => setMessageOpen(false)} /> : null}
      <WorkflowReportDialog open={reportOpen} locale={locale} workflowKey={tree?.workflow_key || ""} recordKey={currentTreeNode.record_key} theme={theme} onClose={() => setReportOpen(false)} onSaved={async () => { setReportOpen(false); await onRefresh(); }} />
    </> : null}
  </section>;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function readMutationError(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = error.data;
    if (typeof data === "string") return data;
    if (data && typeof data === "object" && "detail" in data) return String(data.detail);
  }
  return "The record operation failed.";
}

function MobileRecordEditor({ columns, values, mode, busy, text, onChange, onSave, onCancel }: {
  columns: WorkflowDetail["columns"];
  values: Record<string, unknown>;
  mode: "insert" | "edit";
  busy: boolean;
  text: MobilityCopy;
  onChange: (key: string, value: unknown) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return <form className="mobility-record-editor" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <div className="mobility-record-editor__heading"><strong>{mode === "insert" ? text.insert : text.edit}</strong><button type="button" onClick={onCancel} disabled={busy}>{text.cancel}</button></div>
    <div className="mobility-record-editor__fields">
      {columns.map((column) => {
        const value = values[column.key];
        const inputType = column.data_type === "date" ? "date" : column.data_type === "integer" || column.data_type === "decimal" ? "number" : "text";
        return <label key={column.key}><span>{column.label}</span>{column.data_type === "boolean" ? <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(column.key, event.target.checked)} disabled={busy} /> : <input type={inputType} value={value == null ? "" : String(value)} onChange={(event) => onChange(column.key, event.target.value)} disabled={busy} />}</label>;
      })}
    </div>
    <button className="mobility-button mobility-button--primary" type="submit" disabled={busy}>{text.save}</button>
  </form>;
}

function AccountPanel({ session, catalog, text, onSignOut }: { session: SessionInfo | undefined; catalog: { default_site: string; sites: readonly { value: string }[] } | undefined; text: MobilityCopy; onSignOut: () => void }) {
  return <div className="mobility-stack">
    <section className="mobility-page-heading"><span className="mobility-kicker">{text.profile}</span><h1>{text.account}</h1><p>{text.accountCopy}</p></section>
    <section className="mobility-card">
      <div className="mobility-profile"><span className="mobility-avatar">{initials(session?.display_name ?? "Orbit")}</span><div><h2>{session?.display_name ?? "—"}</h2><p>{session?.login_name ?? "—"}</p></div></div>
      <div className="mobility-detail-list">
        <Detail label={text.organization} value={session?.scope.organization_name ?? "—"} />
        <Detail label={text.department} value={session?.scope.department_name ?? "—"} />
        <Detail label={text.laboratory} value={session?.scope.laboratory_name ?? "—"} />
        <Detail label={text.role} value={session?.roles.join(", ") || "—"} />
        <Detail label={text.defaultSite} value={catalog?.default_site ?? "—"} />
      </div>
      <button type="button" className="mobility-button mobility-button--secondary" onClick={onSignOut}>{text.signOut}</button>
    </section>
  </div>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "blue" | "green" | "orange" }) {
  return <article className={`mobility-metric mobility-metric--${tone}`}><span>{label}</span><strong>{value}</strong></article>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="mobility-detail"><span>{label}</span><strong>{value}</strong></div>;
}

function normalizeRoute(pathname: string): MobilityRoute {
  if (pathname.startsWith("/mobility/workflows")) return "workflows";
  if (pathname.startsWith("/mobility/account")) return "account";
  return "home";
}

function initials(value: string): string {
  return value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "OR";
}

interface MobilityCopy {
  title: string; online: string; connecting: string; secureAccess: string; welcome: string; welcomeCopy: string; signIn: string;
  mobileReady: string; liveData: string; navigation: string; home: string; workflows: string; account: string; today: string;
  goodMorning: string; dashboardCopy: string; organization: string; summary: string; records: string; sites: string; workspace: string;
  quickAccess: string; browseWorkflows: string; browseWorkflowsCopy: string; accountDetails: string; accountDetailsCopy: string;
  workflowsCopy: string; noWorkflows: string; profile: string; accountCopy: string; department: string; laboratory: string; role: string;
  defaultSite: string; signOut: string;
  name: string; area: string; type: string; master: string; active: string; searchWorkflows: string; searchRecords: string;
  selectWorkflow: string; workflowGridCopy: string; backToWorkflows: string; dataRows: string; record: string; selectRow: string;
  steps: string; loading: string; noSteps: string; current: string; completed: string; upcoming: string;
  insert: string; edit: string; duplicate: string; delete: string; save: string; cancel: string; confirmDelete: string;
}

function copyFor(locale: Locale): MobilityCopy {
  if (locale === "en") return {
    title: "Mobile workspace", online: "Online", connecting: "Connecting", secureAccess: "Secure mobile access", welcome: "Work from anywhere.", welcomeCopy: "Review your Orbit workspace, monitor workflows, and stay close to the work that matters.", signIn: "Sign in to Orbit", mobileReady: "Phone ready", liveData: "Live workspace data", navigation: "Mobile workspace navigation", home: "Home", workflows: "Workflows", account: "Account", today: "Your workspace", goodMorning: "Welcome", dashboardCopy: "A focused view of your operational workspace, sized for the phone in your hand.", organization: "Organization", summary: "Workspace summary", records: "Records", sites: "Sites", workspace: "Workspace", quickAccess: "Quick access", browseWorkflows: "Browse workflows", browseWorkflowsCopy: "View available processes and records", accountDetails: "Account details", accountDetailsCopy: "Review your scope and access", workflowsCopy: "Available workflows in your current scope.", noWorkflows: "No workflows are available yet.", profile: "Your profile", accountCopy: "Your Orbit identity and workspace scope.", department: "Department", laboratory: "Laboratory", role: "Roles", defaultSite: "Default site", signOut: "Sign out", name: "Workflow", area: "Area", type: "Type", master: "Master", active: "Active", searchWorkflows: "Search workflows", searchRecords: "Search data rows", selectWorkflow: "Select a workflow", workflowGridCopy: "Tap a workflow to load its data rows", backToWorkflows: "Clear", dataRows: "Data rows", record: "Record", selectRow: "Select a row to view its workflow steps", steps: "Workflow steps", loading: "Loading…", noSteps: "No workflow steps found", current: "Current", completed: "Completed", upcoming: "Upcoming", insert: "Insert", edit: "Edit", duplicate: "Dup row", delete: "Delete", save: "Save", cancel: "Cancel", confirmDelete: "Delete this selected row?",
  };
  return {
    title: "移动工作台", online: "在线", connecting: "连接中", secureAccess: "安全移动访问", welcome: "随时随地处理工作。", welcomeCopy: "查看 Orbit 工作空间、关注流程，并随时掌握重要工作。", signIn: "登录 Orbit", mobileReady: "适配手机", liveData: "实时工作空间数据", navigation: "移动工作台导航", home: "首页", workflows: "工作流", account: "账户", today: "您的工作空间", goodMorning: "欢迎", dashboardCopy: "为手机屏幕优化的运营工作空间视图。", organization: "组织", summary: "工作空间摘要", records: "记录", sites: "站点", workspace: "工作空间", quickAccess: "快捷入口", browseWorkflows: "浏览工作流", browseWorkflowsCopy: "查看可用流程和记录", accountDetails: "账户详情", accountDetailsCopy: "查看您的范围和访问权限", workflowsCopy: "当前范围内可用的工作流。", noWorkflows: "暂无可用工作流。", profile: "个人资料", accountCopy: "您的 Orbit 身份和工作空间范围。", department: "部门", laboratory: "实验室", role: "角色", defaultSite: "默认站点", signOut: "退出登录", name: "工作流", area: "业务域", type: "类型", master: "主流程", active: "启用", searchWorkflows: "搜索工作流", searchRecords: "搜索数据记录", selectWorkflow: "选择工作流", workflowGridCopy: "点击工作流加载数据记录", backToWorkflows: "清除", dataRows: "数据记录", record: "记录", selectRow: "选择记录查看工作流步骤", steps: "工作流步骤", loading: "加载中…", noSteps: "未找到工作流步骤", current: "当前", completed: "已完成", upcoming: "待处理", insert: "新增", edit: "编辑", duplicate: "复制行", delete: "删除", save: "保存", cancel: "取消", confirmDelete: "确定删除当前选中的记录吗？",
  };
}
