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
  isProduction?: boolean;
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

function localizedNotifyText(locale: Locale, en: string, simplified: string, traditional: string): string {
  return locale === "en" ? en : locale === "zh-HK" ? traditional : simplified;
}

function buildSlaNotificationBody(
  locale: Locale,
  templateBody: string,
  workflowName: string,
  stepName: string,
  businessKey: string,
  slaValue: string | null,
  startedAt: string | null,
): string {
  const slaDays = Number(slaValue?.match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 0);
  const start = startedAt ? new Date(startedAt) : null;
  const now = new Date();
  const due = start && slaDays > 0 ? new Date(start.getTime() + slaDays * 86400000) : null;
  const overdueMs = due ? Math.max(0, now.getTime() - due.getTime()) : 0;
  const overdueMinutes = Math.floor(overdueMs / 60000);
  const overdueDays = overdueMs / 86400000;
  const startText = start && !Number.isNaN(start.getTime()) ? formatStepStartTime(start.toISOString(), locale) || start.toISOString() : "-";
  const dueText = due ? formatStepStartTime(due.toISOString(), locale) || due.toISOString() : "-";
  const roundedDays = overdueDays.toFixed(2);
  const minutesText = String(overdueMinutes);
  const body = (templateBody || "")
    .replace(/\[(?:工单号|订单号|工作流单号|评估工单号|order number|ticket number)\]|\{(?:工单号|订单号|工作流单号|评估工单号|order number|ticket number)\}/gi, businessKey || "-")
    .replace(/\[(?:分钟|minutes?|overdue minutes?)\]|\{(?:分钟|minutes?|overdue minutes?)\}/gi, minutesText);
  const detailTitle = localizedNotifyText(locale, "SLA overdue details", "SLA逾期详情", "SLA逾期詳情");
  const labels = locale === "en"
    ? [`Workflow: ${workflowName}`, `Step: ${stepName}`, `Business key: ${businessKey || "-"}`, `Configured SLA: ${slaValue || "-"} day(s)`, `Step start time: ${startText}`, `SLA due time: ${dueText}`, `Overdue: ${roundedDays} day(s) (${overdueMinutes} minute(s))`]
    : locale === "zh-HK"
      ? [`工作流程：${workflowName}`, `步驟：${stepName}`, `業務編號：${businessKey || "-"}`, `SLA 設定：${slaValue || "-"} 日`, `步驟開始時間：${startText}`, `SLA 到期時間：${dueText}`, `逾期：${roundedDays} 日（${overdueMinutes} 分鐘）`]
      : [`工作流：${workflowName}`, `步骤：${stepName}`, `业务编号：${businessKey || "-"}`, `SLA 配置：${slaValue || "-"} 天`, `步骤开始时间：${startText}`, `SLA 到期时间：${dueText}`, `逾期：${roundedDays} 天（${overdueMinutes} 分钟）`];
  return `${body}\n\n${detailTitle}\n${labels.join("\n")}`.trim();
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
  isProduction = true,
}: WorkflowTreePanelProps) {
  const selectedRef = useRef<HTMLLIElement | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [mailComposeOpen, setMailComposeOpen] = useState(false);
  const [mailComposeBody, setMailComposeBody] = useState("");
  const [mailComposeSubject, setMailComposeSubject] = useState("");
  const [notifyComposeMode, setNotifyComposeMode] = useState(false);
  const [notifyActionPending, setNotifyActionPending] = useState(false);
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
  const notifyRequired = Boolean(
    !isProduction && runtimeCurrentNode && currentTreeNode?.record_key === runtimeCurrentNode.record_key && currentTreeNode.notifyType &&
    runtimeCurrentNode.sla_violated && currentTreeNode.notifyAction === false,
  );

  async function openNotifyCompose(): Promise<void> {
    if (!currentTreeNode?.notifyType) return;
    const currentRuntimeNode = runtime?.nodes.find((node) => node.record_key === currentTreeNode.record_key);
    const defaultBody = buildSlaNotificationBody(
      locale,
      "",
      tree?.workflow_name || "Orbit workflow",
      currentTreeNode.label,
      runtime?.instance.business_key || "",
      currentTreeNode.sla,
      currentRuntimeNode?.start_time || currentRuntimeNode?.started_at || null,
    );
    setNotifyActionPending(true);
    setNotifyComposeMode(true);
    setMailComposeSubject(`${translate(locale, "email")} · ${currentTreeNode.record_key}`);
    setMailComposeBody(defaultBody);
    setMailComposeOpen(true);
    try {
      const token = localStorage.getItem("orbit:auth-token");
      const response = await fetch(`/api/v1/workflows/notify-types/${currentTreeNode.notifyType}?locale=${encodeURIComponent(locale)}`, {
        headers: token ? { "X-Orbit-Auth": token } : {},
      });
      if (!response.ok) throw new Error("Notification template unavailable");
      const template = await response.json() as { templateTitle?: string; templateBody?: string };
      setMailComposeSubject(template.templateTitle || `${translate(locale, "email")} · ${currentTreeNode.record_key}`);
      setMailComposeBody(buildSlaNotificationBody(
        locale,
        template.templateBody || "",
        tree?.workflow_name || "Orbit workflow",
        currentTreeNode.label,
        runtime?.instance.business_key || "",
        currentTreeNode.sla,
        currentRuntimeNode?.start_time || currentRuntimeNode?.started_at || null,
      ));
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "Notification template unavailable");
    } finally {
      setNotifyActionPending(false);
    }
  }

  async function markNotifyAction(): Promise<void> {
    if (!tree?.workflow_key || !currentTreeNode) return;
    const token = localStorage.getItem("orbit:auth-token");
    const response = await fetch(`/api/v1/workflows/${encodeURIComponent(tree.workflow_key)}/steps/${currentTreeNode.record_id}/notify-action`, {
      method: "PATCH",
      headers: token ? { "X-Orbit-Auth": token } : {},
    });
    if (!response.ok) throw new Error("Notification status could not be saved");
  }

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
                          {notifyRequired ? (
                            <label className="workflow-report-check workflow-notify-check" title={translate(locale, "notifyAction")}>
                              <input type="checkbox" checked={false} disabled={commandBusy || notifyActionPending} onChange={() => void openNotifyCompose()} />
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
                              setNotifyComposeMode(false);
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
                              setNotifyComposeMode(false);
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
          defaultSubject={mailComposeSubject || `${translate(locale, "email")} · ${currentNode?.record_key || "Orbit workflow"}`}
          onSent={notifyComposeMode ? () => void markNotifyAction() : undefined}
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
