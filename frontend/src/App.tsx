import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  useGetHealthQuery,
  useGetRecordsQuery,
  useGetSessionQuery,
  useGetWorkflowQuery,
  useGetWorkflowTreeQuery,
  useGetWorkflowsQuery,
  useUpdateRecordMutation,
  useCreateRecordMutation,
  useDeleteRecordMutation,
} from "./app/orbitApi";
import { useAppDispatch, useAppSelector } from "./app/store";
import { ApiError } from "./components/ApiError";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { OrbitHeader } from "./components/OrbitHeader";
import { WorkflowCascade } from "./components/WorkflowCascade";
import { WorkflowGrid } from "./components/WorkflowGrid";
import { WorkflowTreePanel } from "./components/WorkflowTreePanel";
import { AuthDialog } from "./components/AuthDialog";
import {
  selectCell,
  selectGroup,
  selectWorkflow,
  setLocale,
  setSearch,
  setSort,
  setTheme,
} from "./features/workflows/workspaceSlice";
import { translate } from "./i18n/translations";
import type { WorkflowRecord } from "./types";

interface PendingConfirmation {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
}


export function App() {
  const dispatch = useAppDispatch();
  const workspace = useAppSelector((state) => state.workspace);
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("orbit:auth-token"));
  const [splitPercent, setSplitPercent] = useState(70);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const resizingRef = useRef(false);
  const deferredSearch = useDeferredValue(workspace.search);
  const deferredSelection = useDeferredValue(workspace.selection);

  const healthQuery = useGetHealthQuery();
  const sessionQuery = useGetSessionQuery(workspace.locale);
  const workflowsQuery = useGetWorkflowsQuery(workspace.locale, { skip: !authToken });
  const workflowQuery = useGetWorkflowQuery({
    workflowKey: workspace.selectedWorkflow,
    locale: workspace.locale,
  }, { refetchOnMountOrArgChange: true, skip: !authToken });
  const recordsQuery = useGetRecordsQuery({
    workflowKey: workspace.selectedWorkflow,
    locale: workspace.locale,
    search: deferredSearch,
    sortBy: workspace.sortBy,
    sortDirection: workspace.sortDirection,
  }, { refetchOnMountOrArgChange: true, skip: !authToken });
  const treeQuery = useGetWorkflowTreeQuery({
    workflowKey: workspace.selectedWorkflow,
    locale: workspace.locale,
    recordId: deferredSelection.recordId,
    cellKey: deferredSelection.cellKey,
  }, { refetchOnMountOrArgChange: true, skip: !authToken });
  const [updateRecord] = useUpdateRecordMutation();
  const [createRecord] = useCreateRecordMutation();
  const [deleteRecord] = useDeleteRecordMutation();
  const [dirtyRecordIds, setDirtyRecordIds] = useState<Set<string>>(new Set());
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [authOpen, setAuthOpen] = useState(() => !localStorage.getItem("orbit:auth-token"));

  useEffect(() => {
    document.documentElement.lang = workspace.locale;
  }, [workspace.locale]);

  useEffect(() => {
    document.documentElement.dataset.theme = workspace.theme;
  }, [workspace.theme]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!resizingRef.current || !workspaceRef.current) return;
      const bounds = workspaceRef.current.getBoundingClientRect();
      const next = ((event.clientX - bounds.left) / bounds.width) * 100;
      setSplitPercent(Math.max(52, Math.min(78, next)));
    };
    const stop = () => {
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, []);

  function beginSplitResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    resizingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  useEffect(() => {
    const errors = [workflowsQuery.error, workflowQuery.error, recordsQuery.error, treeQuery.error];
    if (authToken && errors.some((error) => isUnauthorized(error))) {
      localStorage.removeItem("orbit:auth-token");
      setAuthToken(null);
      setAuthOpen(true);
    }
  }, [authToken, recordsQuery.error, treeQuery.error, workflowQuery.error, workflowsQuery.error]);

  useEffect(() => {
    const workflows = workflowsQuery.data;
    if (!workflows?.length) return;
    if (!workflows.some(
      (workflow) =>
        workflow.key === workspace.selectedWorkflow &&
        !workflow.is_master &&
        workflow.definition_type === "workflow",
    )) {
      const first = workflows.find(
        (workflow) => !workflow.is_master && workflow.definition_type === "workflow",
      );
      if (first) {
        dispatch(selectGroup(first.group_key));
        dispatch(selectWorkflow(first.key));
      }
    }
  }, [dispatch, workspace.selectedWorkflow, workflowsQuery.data]);

  function handleGroupSelect(group: string) {
    const isPeopleOperations = group === "people-operations";
    const selectedGroup = isPeopleOperations ? "hr" : "sales";
    const first = workflowsQuery.data?.find(
      (workflow) =>
        !workflow.is_master &&
        workflow.definition_type === "workflow" &&
        (isPeopleOperations
          ? workflow.group_key === "hr"
          : workflow.group_key !== "hr"),
    );
    if (first) requestWorkflowNavigation(selectedGroup, first.key);
  }

  function handleWorkflowSelect(workflowKey: string) {
    const selected = workflowsQuery.data?.find((workflow) => workflow.key === workflowKey);
    if (selected) requestWorkflowNavigation(selected.group_key, workflowKey);
  }

  function requestWorkflowNavigation(group: string, workflowKey: string) {
    const commit = () => {
      setDirtyRecordIds(new Set());
      dispatch(selectGroup(group));
      dispatch(selectWorkflow(workflowKey));
    };
    if (dirtyRecordIds.size === 0 || workflowKey === workspace.selectedWorkflow) {
      commit();
      return;
    }
    setPendingConfirmation({
      title: workspace.locale === "en" ? "Leave edited rows?" : "离开已编辑记录？",
      message: workspace.locale === "en"
        ? "Some rows were edited. The changes are saved, but the edited rows are still marked in this view. Continue navigating?"
        : "部分记录已编辑。更改已保存，但当前视图仍标记这些记录。确定继续切换吗？",
      confirmLabel: workspace.locale === "en" ? "Continue" : "继续",
      onConfirm: commit,
    });
  }

  async function handleRecordUpdate(
    record: WorkflowRecord,
    key: string,
    value: unknown,
  ): Promise<WorkflowRecord> {
    const updated = await updateRecord({
      workflowKey: workspace.selectedWorkflow,
      recordId: record.id,
      values: { [key]: value },
      version: record.version,
      locale: workspace.locale,
    }).unwrap();
    setDirtyRecordIds((current) => new Set(current).add(updated.id));
    return updated;
  }

  async function handleRecordAdd(): Promise<WorkflowRecord> {
    const values = Object.fromEntries(
      (workflow?.columns || [])
        .filter((column) => column.editable)
        .map((column) => [column.key, ""]),
    );
    return createRecord({ workflowKey: workspace.selectedWorkflow, values, locale: workspace.locale }).unwrap();
  }

  async function handleRecordDelete(record: WorkflowRecord): Promise<void> {
    setPendingConfirmation({
      title: workspace.locale === "en" ? "Delete this row?" : "删除这条记录？",
      message: workspace.locale === "en"
        ? "This action cannot be undone. The record will be removed from the business data table."
        : "此操作无法撤销，记录将从业务数据表中删除。",
      confirmLabel: workspace.locale === "en" ? "Delete" : "删除",
      onConfirm: async () => {
        await deleteRecord({ workflowKey: workspace.selectedWorkflow, recordId: record.id }).unwrap();
        setDirtyRecordIds((current) => {
          const next = new Set(current);
          next.delete(record.id);
          return next;
        });
      },
    });
  }

  async function confirmPendingAction() {
    if (!pendingConfirmation) return;
    setConfirmationBusy(true);
    try {
      await pendingConfirmation.onConfirm();
      setPendingConfirmation(null);
    } finally {
      setConfirmationBusy(false);
    }
  }


  function retryAll() {
    void healthQuery.refetch();
    void sessionQuery.refetch();
    void workflowsQuery.refetch();
    void workflowQuery.refetch();
    void recordsQuery.refetch();
  }

  const hasBlockingError =
    workflowsQuery.isError || workflowQuery.isError || recordsQuery.isError;
  const workflow = workflowQuery.data;
  const records = recordsQuery.data?.items || [];

  return (
    <div className="orbit-shell">
      <OrbitHeader
        locale={workspace.locale}
        session={sessionQuery.data}
        health={healthQuery.data}
        onLocaleChange={(locale) => dispatch(setLocale(locale))}
        theme={workspace.theme}
        onThemeChange={(theme) => dispatch(setTheme(theme))}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={() => {
          localStorage.removeItem("orbit:auth-token");
          setAuthToken(null);
          setAuthOpen(true);
          void sessionQuery.refetch();
        }}
      />

      <AuthDialog
        open={authOpen}
        locale={workspace.locale}
        onClose={() => setAuthOpen(false)}
        onSignedIn={(_user, token) => {
          setAuthToken(token);
          setAuthOpen(false);
          void sessionQuery.refetch();
          void workflowsQuery.refetch();
          void workflowQuery.refetch();
          void recordsQuery.refetch();
          void treeQuery.refetch();
        }}
      />

      <main
        className="orbit-workspace"
        ref={workspaceRef}
        style={{ "--split-percent": splitPercent + "%" } as CSSProperties}
      >
        <section className="data-panel">
          <WorkflowCascade
            locale={workspace.locale}
            workflows={workflowsQuery.data || []}
            selectedGroup={workspace.selectedGroup}
            selectedWorkflow={workspace.selectedWorkflow}
            onGroupSelect={handleGroupSelect}
            onWorkflowSelect={handleWorkflowSelect}
          />

          <div className="data-panel__toolbar">
            <div className="workflow-heading">
              <div>
                <h1>{workflow?.name || translate(workspace.locale, "loading")}</h1>
                <p>
                  {workflow
                    ? `${translate(workspace.locale, "source")}: database · orbit_workflow.workflow_business_record · ${workflow.definition_type}`
                    : "Database-backed business records"}
                </p>
              </div>
            </div>

            <div className="toolbar-actions">
              <label className="search-box">
                <span aria-hidden="true">⌕</span>
                <input
                  value={workspace.search}
                  onChange={(event) => dispatch(setSearch(event.target.value))}
                  placeholder={translate(workspace.locale, "search")}
                  type="search"
                />
              </label>
              <div className="record-stat">
                <b>{recordsQuery.data?.total || 0}</b>
                <span>{translate(workspace.locale, "rowsVisible")}</span>
              </div>
              <span
                className={`access-badge ${workflow?.access.can_edit ? "is-editable" : ""}`}
              >
                {translate(
                  workspace.locale,
                  workflow?.access.can_edit ? "editable" : "readOnly",
                )}
              </span>
            </div>
          </div>

          {hasBlockingError ? (
            <ApiError locale={workspace.locale} onRetry={retryAll} />
          ) : (
            <WorkflowGrid
              key={`${workspace.selectedWorkflow}:${workspace.locale}:${workspace.theme}`}
              locale={workspace.locale}
              theme={workspace.theme}
              workflow={workflow}
              records={records}
              dirtyRecordIds={[...dirtyRecordIds]}
              loading={recordsQuery.isLoading || workflowQuery.isLoading}
              onCellSelect={(recordId, cellKey) =>
                dispatch(selectCell({ recordId, cellKey }))
              }
              onRecordUpdate={handleRecordUpdate}
              onRecordAdd={handleRecordAdd}
              onRecordDelete={handleRecordDelete}
              onRecordFinishEdit={(recordId) => {
                setDirtyRecordIds((current) => {
                  const next = new Set(current);
                  next.delete(recordId);
                  return next;
                });
              }}
              onSortChange={(sortBy, sortDirection) =>
                dispatch(setSort({ sortBy, sortDirection }))
              }
            />
          )}
        </section>

        <div
          className="workspace-splitter"
          role="separator"
          aria-label="Resize workflow tree panel"
          aria-valuemin={52}
          aria-valuemax={78}
          aria-valuenow={Math.round(splitPercent)}
          onPointerDown={beginSplitResize}
        >
          <span />
        </div>

        <WorkflowTreePanel
          key={`${workspace.selectedWorkflow}:${workspace.locale}`}
          locale={workspace.locale}
          tree={treeQuery.data}
          columns={workflow?.columns || []}
          isWorkflow={workflow?.definition_type === "workflow"}
          loading={treeQuery.isLoading || treeQuery.isFetching}
        />
      </main>
      {pendingConfirmation ? (
        <ConfirmDialog
          title={pendingConfirmation.title}
          message={pendingConfirmation.message}
          confirmLabel={pendingConfirmation.confirmLabel}
          cancelLabel={workspace.locale === "en" ? "Cancel" : "取消"}
          busy={confirmationBusy}
          onConfirm={() => void confirmPendingAction()}
          onCancel={() => {
            if (!confirmationBusy) setPendingConfirmation(null);
          }}
        />
      ) : null}
    </div>
  );
}

function isUnauthorized(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "status" in error && error.status === 401);
}
