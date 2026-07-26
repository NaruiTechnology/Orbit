import { useEffect, useRef, useState } from "react";

import mailIcon from "../assets/mail-icon.svg";
import peopleIcon from "../assets/people-icon.svg";
import cogIcon from "../assets/cog-icon.svg";
import { MailComposeDialog } from "./MailComposeDialog";
import { WorkflowMessageDialog } from "./WorkflowMessageDialog";
import { WorkflowReportDialog } from "./WorkflowReportDialog";
import type {
  Locale,
  ThemeMode,
  WorkflowCommandInput,
  WorkflowRuntimeProjection,
  WorkflowTree,
  ReportTemplateSaveResponse,
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
  theme = "navy",
}: WorkflowTreePanelProps) {
  const selectedRef = useRef<HTMLLIElement | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [mailComposeOpen, setMailComposeOpen] = useState(false);
  const [mailComposeBody, setMailComposeBody] = useState("");
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const reportContextRef = useRef<string | null>(null);
  const currentNode = runtime?.nodes.find(
    (node) => node.record_key === runtime.instance.current_record_key,
  );
  const currentTreeNode = tree?.nodes.find(
    (node) => node.record_key === runtime?.instance.current_record_key,
  );
  const runtimeByKey = new Map((runtime?.nodes || []).map((node) => [node.record_key, node]));

  const reportContextKey = `${tree?.workflow_key || ""}:${runtime?.instance.id || ""}:${currentNode?.record_key || ""}`;
  useEffect(() => {
    if (!currentNode || !currentTreeNode) {
      setReportDialogOpen(false);
      reportContextRef.current = null;
      return;
    }
    if (!reportContextKey || reportContextRef.current === reportContextKey) return;
    reportContextRef.current = reportContextKey;
    setReportDialogOpen(false);
    if (currentNode?.record_key === currentTreeNode?.record_key && currentTreeNode?.action === false) {
      setReportDialogOpen(true);
    }
  }, [reportContextKey, currentNode, currentTreeNode]);

  async function send(command: string, payload?: Record<string, unknown>) {
    if (!runtime || !onCommand || !currentNode) return;
    const commandInput: WorkflowCommandInput = {
      command,
      nodeKey: currentNode.record_key,
      version: runtime.instance.version,
    };
    if (payload) commandInput.payload = payload;
    if (command === "abort") {
      const abortReason = window.prompt(translate(locale, "reason"));
      if (!abortReason?.trim()) return;
      commandInput.reason = abortReason.trim();
    }
    try {
      setCommandError(null);
      await onCommand(commandInput);
    } catch (error) {
      setCommandError(formatCommandError(error));
    }
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
              const warning = Boolean(
                runtimeNode?.sla_violated &&
                (runtimeNode.status === "active" || runtimeNode.status === "waiting"),
              );
              const isCurrent = Boolean(
                runtimeNode &&
                runtimeNode.record_key === runtime?.instance.current_record_key &&
                (runtimeNode.status === "active" || runtimeNode.status === "waiting"),
              );
              const state = runtime
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
                  className={`workflow-node workflow-node--${state}`}
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
                    {node.sla ? (
                      <span className="workflow-node__sla">
                        {translate(locale, "sla")}: {node.sla}
                      </span>
                    ) : null}
                    {node.ContactName ? (
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
                              disabled={commandBusy || runtimeNode.status === "completed"}
                              onChange={() => void send("submit")}
                            />
                            <span>{translate(locale, "submit")}</span>
                          </label>
                          <label className="workflow-report-check" title={translate(locale, "actionReport")}>
                            <input
                              type="checkbox"
                              checked={currentTreeNode?.action === true}
                              disabled={commandBusy || currentTreeNode?.action === true}
                              onChange={() => setReportDialogOpen(true)}
                            />
                          </label>
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
                          <button
                            type="button"
                            className="workflow-abort"
                            disabled={commandBusy}
                            onClick={() => void send("abort")}
                          >
                            {translate(locale, "abort")}
                          </button>
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
            setReportDialogOpen(false);
          }}
          theme={theme}
        />
      ) : null}
    </aside>
  );
}
