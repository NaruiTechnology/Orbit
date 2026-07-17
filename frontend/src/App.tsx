import { useDeferredValue, useEffect } from "react";

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
import { OrbitHeader } from "./components/OrbitHeader";
import { WorkflowCascade } from "./components/WorkflowCascade";
import { WorkflowGrid } from "./components/WorkflowGrid";
import { WorkflowTreePanel } from "./components/WorkflowTreePanel";
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


export function App() {
  const dispatch = useAppDispatch();
  const workspace = useAppSelector((state) => state.workspace);
  const deferredSearch = useDeferredValue(workspace.search);
  const deferredSelection = useDeferredValue(workspace.selection);

  const healthQuery = useGetHealthQuery();
  const sessionQuery = useGetSessionQuery(workspace.locale);
  const workflowsQuery = useGetWorkflowsQuery(workspace.locale);
  const workflowQuery = useGetWorkflowQuery({
    workflowKey: workspace.selectedWorkflow,
    locale: workspace.locale,
  });
  const recordsQuery = useGetRecordsQuery({
    workflowKey: workspace.selectedWorkflow,
    locale: workspace.locale,
    search: deferredSearch,
    sortBy: workspace.sortBy,
    sortDirection: workspace.sortDirection,
  });
  const treeQuery = useGetWorkflowTreeQuery({
    workflowKey: workspace.selectedWorkflow,
    locale: workspace.locale,
    recordId: deferredSelection.recordId,
    cellKey: deferredSelection.cellKey,
  });
  const [updateRecord] = useUpdateRecordMutation();
  const [createRecord] = useCreateRecordMutation();
  const [deleteRecord] = useDeleteRecordMutation();

  useEffect(() => {
    document.documentElement.lang = workspace.locale;
  }, [workspace.locale]);

  useEffect(() => {
    document.documentElement.dataset.theme = workspace.theme;
  }, [workspace.theme]);

  useEffect(() => {
    const workflows = workflowsQuery.data;
    if (!workflows?.length) return;
    if (!workflows.some((workflow) => workflow.key === workspace.selectedWorkflow)) {
      const first = workflows[0];
      if (first) {
        dispatch(selectGroup(first.group_key));
        dispatch(selectWorkflow(first.key));
      }
    }
  }, [dispatch, workspace.selectedWorkflow, workflowsQuery.data]);

  function handleGroupSelect(group: string) {
    const isPeopleOperations = group === "people-operations";
    const selectedGroup = isPeopleOperations ? "hr" : "sales";
    dispatch(selectGroup(selectedGroup));
    const first = workflowsQuery.data?.find(
      (workflow) =>
        !workflow.is_master &&
        (isPeopleOperations
          ? workflow.group_key === "hr"
          : workflow.group_key !== "hr"),
    );
    if (first) dispatch(selectWorkflow(first.key));
  }

  function handleWorkflowSelect(workflowKey: string) {
    const selected = workflowsQuery.data?.find((workflow) => workflow.key === workflowKey);
    if (selected) dispatch(selectGroup(selected.group_key));
    dispatch(selectWorkflow(workflowKey));
  }

  async function handleRecordUpdate(
    record: WorkflowRecord,
    key: string,
    value: unknown,
  ): Promise<WorkflowRecord> {
    return updateRecord({
      workflowKey: workspace.selectedWorkflow,
      recordId: record.id,
      values: { [key]: value },
      version: record.version,
      locale: workspace.locale,
    }).unwrap();
  }

  async function handleRecordAdd(): Promise<WorkflowRecord> {
    const values = Object.fromEntries(
      (workflow?.columns || [])
        .filter((column) => column.editable)
        .map((column) => [column.key, column.data_type === "boolean" ? false : ""]),
    );
    return createRecord({ workflowKey: workspace.selectedWorkflow, values, locale: workspace.locale }).unwrap();
  }

  async function handleRecordDelete(record: WorkflowRecord): Promise<void> {
    if (!window.confirm(workspace.locale === "en" ? "Delete this row?" : "确定删除此行吗？")) return;
    await deleteRecord({ workflowKey: workspace.selectedWorkflow, recordId: record.id }).unwrap();
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
      />

      <main className="orbit-workspace">
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
              locale={workspace.locale}
              theme={workspace.theme}
              workflow={workflow}
              records={records}
              loading={recordsQuery.isLoading || workflowQuery.isLoading}
              onCellSelect={(recordId, cellKey) =>
                dispatch(selectCell({ recordId, cellKey }))
              }
              onRecordUpdate={handleRecordUpdate}
              onRecordAdd={handleRecordAdd}
              onRecordDelete={handleRecordDelete}
              onSortChange={(sortBy, sortDirection) =>
                dispatch(setSort({ sortBy, sortDirection }))
              }
            />
          )}
        </section>

        <WorkflowTreePanel
          locale={workspace.locale}
          tree={treeQuery.data}
          columns={workflow?.columns || []}
          loading={treeQuery.isLoading || treeQuery.isFetching}
        />
      </main>
    </div>
  );
}
