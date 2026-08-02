import { useEffect, useRef, useState } from "react";

import mailIcon from "../assets/mail-icon.svg";
import peopleIcon from "../assets/people-icon.svg";
import cogIcon from "../assets/cog-icon.svg";
import { MailComposeDialog } from "./MailComposeDialog";
import { WorkflowMessageDialog } from "./WorkflowMessageDialog";
import { WorkflowReportDialog } from "./WorkflowReportDialog";
import { WorkflowDecisionDialog } from "./WorkflowDecisionDialog";
import { WorkflowReasonDialog } from "./WorkflowReasonDialog";
import type {
  Locale,
  ThemeMode,
  WorkflowCommandInput,
  WorkflowRuntimeProjection,
  WorkflowTree,
  ReportTemplateSaveResponse,
  WorkflowDecisionCatalog,
  WorkflowRecord,
} from "../types";
import { translate } from "../i18n/translations";

interface WorkflowTreePanelProps {
  locale: Locale;
  tree: WorkflowTree | undefined;
  isWorkflow: boolean;
  loading: boolean;
  runtime?: WorkflowRuntimeProjection | undefined;
  commandBusy?: boolean;
  onCommand?: (command: WorkflowCommandInput) => Promise<void>;
  onSaveMessage?: (recordId: string, message: string) => Promise<void>;
  messageBusy?: boolean;
  onSaveReport?: (result: ReportTemplateSaveResponse) => Promise<void>;
  currentRecord?: WorkflowRecord | undefined;
  decisionCatalogs?: WorkflowDecisionCatalog[];
  onDecisionGoto?: (workflowKey: string, stepKey: string) => void;
  theme?: ThemeMode;
}

function formatCommandError(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = error.data;
    if (typeof data === "string") return data;
    if (data && typeof data === "object" && "detail" in data) return String(data.detail);
  }
  return "Workflow command failed";
}

function formatStepStartTime(value: string | null | undefined, locale: Locale): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const dateLocale = locale === "en" ? "en-US" : locale;
  return new Intl.DateTimeFormat(dateLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function WorkflowTreePanel({
  locale,
  tree,
  isWorkflow,
  loading,
  runtime,
  commandBusy = false,
  onCommand,
  onSaveMessage,
  messageBusy = false,
  onSaveReport,
  currentRecord,
  decisionCatalogs = [],
  onDecisionGoto,
  theme = "navy",
}: WorkflowTreePanelProps) {
  const selectedRef = useRef<HTMLLIElement | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [mailComposeOpen, setMailComposeOpen] = useState(false);
  const [mailComposeBody, setMailComposeBody] = useState("");
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [decisionDialogOpen, setDecisionDialogOpen] = useState(false);
  const [reasonDialogOpen, setReasonDialogOpen] = useState(false);
  const [abortReason, setAbortReason] = useState("");
  const [abortHelpOpen, setAbortHelpOpen] = useState(false);
  const decisionContextRef = useRef<string | null>(null);
  const suppressNextDecisionDialogRef = useRef(false);
  const [savedReportContext, setSavedReportContext] = useState<string | null>(null);
  const reportContextRef = useRef<string | null>(null);
  const runtimeCurrentNode = runtime?.nodes.find(
    (node) => node.record_key === runtime.instance.current_record_key,
  );
  const runtimeCurrentTreeNode = tree?.nodes.find(
    (node) => node.record_key === runtime?.instance.current_record_key,
  );
  const selectedTreeNode = tree?.nodes.find((node) => node.is_selected) || runtimeCurrentTreeNode;
  const currentTreeNode = selectedTreeNode;
  const currentNode = runtime?.nodes.find(
    (node) => node.record_key === selectedTreeNode?.record_key,
  ) || runtimeCurrentNode;
  const lastTreeNode = tree?.nodes[tree.nodes.length - 1];
  const isLastWorkflowStep = Boolean(
    currentTreeNode && lastTreeNode?.record_key === currentTreeNode.record_key,
  );
  const runtimeByKey = new Map((runtime?.nodes || []).map((node) => [node.record_key, node]));

  const reportContextKey = `${tree?.workflow_key || ""}:${runtime?.instance.id || ""}:${currentNode?.record_key || ""}`;
  const reportActionCompleted = Boolean(
    currentTreeNode?.DocumentAction === true || savedReportContext === reportContextKey,
  );
  const documentActionRequired = Boolean(
    currentTreeNode?.business_entity && currentTreeNode.DocumentAction !== true,
  );
  const decisionRequired = Boolean(currentTreeNode?.decisionAction);
  useEffect(() => {
    if (!currentNode || !currentTreeNode) {
      setReportDialogOpen(false);
      reportContextRef.current = null;
      return;
    }
    if (!reportContextKey || reportContextRef.current === reportContextKey) return;
    reportContextRef.current = reportContextKey;
    setSavedReportContext(null);
    setReportDialogOpen(false);
    if (
      currentNode?.record_key === currentTreeNode?.record_key &&
      currentTreeNode.business_entity &&
      currentTreeNode.DocumentAction !== true &&
      savedReportContext !== reportContextKey
    ) {
      setReportDialogOpen(true);
    }
  }, [reportContextKey, currentNode, currentTreeNode]);
  useEffect(() => {
    if (!currentNode || !currentTreeNode || !decisionRequired || !currentRecord || !onDecisionGoto) return;
    if (currentNode.status !== "active" && currentNode.status !== "waiting") return;
    if (documentActionRequired && !reportActionCompleted) return;
    const contextKey = `${runtime?.instance.id || ""}:${currentNode.record_key}`;
    if (decisionContextRef.current === contextKey) return;
    decisionContextRef.current = contextKey;
    if (suppressNextDecisionDialogRef.current) {
      suppressNextDecisionDialogRef.current = false;
      return;
    }
    setDecisionDialogOpen(true);
  }, [runtime?.instance.id, currentNode?.record_key, currentNode?.status, currentTreeNode?.record_key, decisionRequired, documentActionRequired, reportActionCompleted, currentRecord, onDecisionGoto]);

  async function send(command: string, payload?: Record<string, unknown>, reason?: string) {
    if (!runtime || !onCommand || !currentNode) return;
    if (command === "abort" && reason === undefined) {
      setAbortReason("");
      setReasonDialogOpen(true);
      return;
    }
    const commandInput: WorkflowCommandInput = {
      command,
      nodeKey: currentNode.record_key,
      version: runtime.instance.version,
    };
    if (payload) commandInput.payload = payload;
    if (command === "abort") {
      if (!reason?.trim()) return;
      commandInput.reason = reason.trim();
    }
    try {
      setCommandError(null);
      await onCommand(commandInput);
    } catch (error) {
      setCommandError(formatCommandError(error));
    }
  }

  async function confirmAbort(): Promise<void> {
    setReasonDialogOpen(false);
    await send("abort", undefined, abortReason);
  }

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [tree?.selected_record_id]);

  useEffect(() => {
    setCommandError(null);
  }, [runtime?.instance.id, runtime?.instance.current_record_key]);

  return (
    <aside className="tree-panel">
      <div className="tree-panel__header">
        <div>
          <h2>{translate(locale, isWorkflow ? "workflowTree" : "backgroundLogic")}</h2>
        </div>
        <span className="tree-panel__count">{tree?.nodes.length || 0}</span>
      </div>

      <div className="tree-scroll" aria-busy={loading}>
        {loading ? (
          <div className="tree-loading">
            {Array.from({ length: 7 }, (_, index) => (
              <span key={index} style={{ animationDelay: `${index * 70}ms` }} />
            ))}
          </div>
        ) : (
          <ol className="workflow-tree">
            {(tree?.nodes || []).map((node) => {
              const runtimeNode = runtimeByKey.get(node.record_key);
              const stepStartTime = formatStepStartTime(
                runtimeNode?.start_time || runtimeNode?.started_at,
                locale,
              );
              const canSubmit = runtimeNode?.available_actions.includes("submit") ?? false;
              const warning = Boolean(
                runtimeNode?.sla_violated &&
                (runtimeNode.status === "active" || runtimeNode.status === "waiting"),
              );
              const isCurrent = Boolean(
                runtimeNode && (node.is_selected || (
                  !tree?.nodes.some((item) => item.is_selected) &&
                  runtimeNode.record_key === runtime?.instance.current_record_key &&
                  (runtimeNode.status === "active" || runtimeNode.status === "waiting")
                )),
              );
              const runtimeCancelled = runtime?.instance.status === "cancelled";
              const state = node.is_selected
                ? "current"
                : !runtimeCancelled && node.is_before_selected
                  ? "complete"
                  : runtime
                ? warning
                  ? "warning"
                  : runtimeNode?.status === "completed"
                  ? "complete"
                  : isCurrent
                    ? "current"
                    : "upcoming"
                : node.is_selected
                  ? "current"
                  : node.is_before_selected
                    ? "complete"
                    : "upcoming";
              return (
                <li
                  className={`workflow-node workflow-node--${state}${abortHelpOpen && isCurrent ? " workflow-node--help-open" : ""}`}
                  key={node.record_key}
                  ref={node.is_selected ? selectedRef : undefined}
                >
                  <div className="workflow-node__rail">
                    <span>{String(node.order).padStart(2, "0")}</span>
                  </div>
                  <div className="workflow-node__body">
                    <small>
                      {state === "warning"
                        ? translate(locale, "warningStep")
                        : state === "current"
                        ? translate(locale, "currentStep")
                        : state === "complete"
                          ? translate(locale, "completedStep")
                          : translate(locale, "upcomingStep")}
                    </small>
                    <b>{node.label}</b>
                    {node.owner_role || node.time_limit ? (
                      <span>
                        {[node.owner_role, node.time_limit].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                    {node.owner_name ? (
                      <span>{translate(locale, "owner")}: {node.owner_name}</span>
                    ) : null}
                    {node.sla ? (
                      <span className="workflow-node__sla">
                        {translate(locale, "sla")}: {node.sla}
                      </span>
                    ) : null}
                    {stepStartTime ? (
                      <span>
                        {translate(locale, "stepStartTime")}: {stepStartTime}
                      </span>
                    ) : null}
                    {node.ContactName && node.ContactName !== node.owner_name ? (
                      <span>{translate(locale, "contactName")}: {node.ContactName}</span>
                    ) : null}
                    {node.Email ? (
                      <span>{translate(locale, "contactEmail")}: {node.Email}</span>
                    ) : null}
                    {isWorkflow && runtime && runtimeNode && isCurrent ? (
                      <div className="workflow-actions" aria-label={translate(locale, "nodeStatus")}>
                        {commandError || runtimeNode.error_message ? (
                          <div className="workflow-error" role="alert">
                            <b>{translate(locale, "error")}</b>
                            <span>{commandError || runtimeNode.error_message}</span>
                          </div>
                        ) : null}
                        <div className="workflow-action-row">
                          <label className="workflow-check">
                            <input
                              type="checkbox"
                              checked={runtimeNode.status === "completed"}
                              disabled={commandBusy || !canSubmit || runtimeNode.status === "completed" || (!isLastWorkflowStep && currentTreeNode?.DocumentAction !== null && !reportActionCompleted)}
                              title={!canSubmit ? translate(locale, "readOnly") : undefined}
                              onChange={() => void send("submit")}
                            />
                            <span>{translate(locale, "submit")}</span>
                          </label>
                          {currentTreeNode?.business_entity && currentTreeNode.DocumentAction !== null ? (
                            <label className={`workflow-report-check ${!reportActionCompleted ? "workflow-report-check--pending" : ""}`} title={translate(locale, "actionReport")}>
                              <input
                                type="checkbox"
                                checked={reportActionCompleted}
                                disabled={commandBusy || reportActionCompleted}
                                onChange={() => setReportDialogOpen(true)}
                              />
                              {!reportActionCompleted ? <span className="workflow-report-check__required" aria-hidden="true">*</span> : null}
                            </label>
                          ) : null}
                          {decisionRequired ? (
                            <label className="workflow-report-check workflow-decision-check" title={locale === "en" ? "Decision action" : "决策动作"}>
                              <input type="checkbox" checked={false} onChange={() => setDecisionDialogOpen(true)} />
                              <span className="workflow-report-check__required" aria-hidden="true">*</span>
                            </label>
                          ) : null}
                          <button
                            type="button"
                            className="workflow-email-button"
                            aria-label={translate(locale, "addMessage")}
                            title={translate(locale, "addMessage")}
                            disabled={commandBusy || messageBusy || !currentTreeNode}
                            onClick={() => setMessageDialogOpen(true)}
                          >
                            <img src={cogIcon} alt="" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="workflow-email-button"
                            aria-label={translate(locale, "email")}
                            title={translate(locale, "email")}
                            disabled={commandBusy}
                            onClick={() => {
                              setMailComposeBody("");
                              setMailComposeOpen(true);
                            }}
                          >
                            <img src={mailIcon} alt="" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="workflow-email-button"
                            aria-label={currentTreeNode?.ContactName || translate(locale, "contact")}
                            title={currentTreeNode?.ContactName || translate(locale, "contact")}
                            disabled={commandBusy}
                            onClick={() => {
                              const contactName = currentTreeNode?.ContactName?.trim() || "";
                              setMailComposeBody(contactName ? `DEAR ${contactName}` : "DEAR");
                              setMailComposeOpen(true);
                            }}
                          >
                            <img src={peopleIcon} alt="" aria-hidden="true" />
                          </button>
                          <span
                            className="workflow-abort-group"
                            onMouseEnter={() => setAbortHelpOpen(true)}
                            onMouseLeave={() => setAbortHelpOpen(false)}
                          >
                            <button
                              type="button"
                              className="workflow-abort"
                              disabled={commandBusy}
                              onClick={() => void send("abort")}
                            >
                              {translate(locale, "abort")}
                            </button>
                            <button
                              type="button"
                              className="workflow-action-help"
                              aria-label={translate(locale, "abortHelpTitle")}
                              aria-expanded={abortHelpOpen}
                              onFocus={() => setAbortHelpOpen(true)}
                              onBlur={() => setAbortHelpOpen(false)}
                            >
                              ?
                            </button>
                            {abortHelpOpen ? (
                              <div className="business-entity-help-popover workflow-abort-help-popover" role="tooltip" onClick={(event) => event.stopPropagation()}>
                                <strong>{translate(locale, "abortHelpTitle")}</strong>
                                <p>{translate(locale, "abortHelpBody")}</p>
                              </div>
                            ) : null}
                          </span>
                        </div>
                        {(runtimeNode.status === "failed" || runtimeNode.status === "blocked") ? (
                          <button type="button" disabled={commandBusy} onClick={() => void send("resubmit")}>
                            {translate(locale, "resubmit")}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {mailComposeOpen ? (
        <MailComposeDialog
          locale={locale}
          defaultTo={currentTreeNode?.Email || ""}
          defaultBody={mailComposeBody}
          defaultSubject={`${translate(locale, "email")} · ${currentNode?.record_key || "Orbit workflow"}`}
          onClose={() => setMailComposeOpen(false)}
        />
      ) : null}
      {messageDialogOpen && currentTreeNode ? (
        <WorkflowMessageDialog
          locale={locale}
          messages={currentTreeNode.Messages}
          busy={messageBusy}
          onSave={(message) => onSaveMessage?.(currentTreeNode.record_id, message) || Promise.resolve()}
          onClose={() => setMessageDialogOpen(false)}
        />
      ) : null}
      {reportDialogOpen && currentTreeNode && currentNode ? (
        <WorkflowReportDialog
          locale={locale}
          open={reportDialogOpen}
          workflowKey={tree?.workflow_key || ""}
          recordKey={currentNode.record_key}
          onClose={() => setReportDialogOpen(false)}
          onSaved={async (result) => {
            await onSaveReport?.(result);
            setSavedReportContext(reportContextKey);
            setReportDialogOpen(false);
          }}
          theme={theme}
        />
      ) : null}
      {decisionDialogOpen && currentRecord && onDecisionGoto ? (
        <WorkflowDecisionDialog
          locale={locale}
          record={currentRecord}
          catalogs={decisionCatalogs}
          onClose={() => setDecisionDialogOpen(false)}
          onGoto={(workflowKey, stepKey) => {
            suppressNextDecisionDialogRef.current = true;
            setDecisionDialogOpen(false);
            onDecisionGoto(workflowKey, stepKey);
          }}
        />
      ) : null}
      {reasonDialogOpen ? (
        <WorkflowReasonDialog
          locale={locale}
          value={abortReason}
          onChange={setAbortReason}
          onClose={() => setReasonDialogOpen(false)}
          onConfirm={() => void confirmAbort()}
        />
      ) : null}
    </aside>
  );
}
