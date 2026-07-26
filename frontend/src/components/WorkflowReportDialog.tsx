import { useEffect, useState } from "react";

import cancelIcon from "../assets/cancel-icon.svg";
import saveIcon from "../assets/save-icon.svg";
import {
  useGetReportStylesheetQuery,
  useGetReportTemplateQuery,
  useSaveReportTemplateMutation,
} from "../app/orbitApi";
import type { Locale, ReportTemplateSaveResponse, ThemeMode } from "../types";
import { translate } from "../i18n/translations";

interface WorkflowReportDialogProps {
  locale: Locale;
  open: boolean;
  workflowKey: string;
  recordKey: string;
  onClose: () => void;
  onSaved: (result: ReportTemplateSaveResponse) => Promise<void>;
  theme: ThemeMode;
}

interface ReportFieldValue { key: string; value: string }

function errorText(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = error.data;
    if (data && typeof data === "object" && "detail" in data) return String(data.detail);
  }
  return fallback;
}

function fallbackHtml(xml: string): string {
  return `<html><body><pre style="white-space:pre-wrap;font:14px sans-serif;padding:24px">${xml.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre></body></html>`;
}

function applyTheme(html: string, theme: ThemeMode): string {
  const accents: Record<ThemeMode, string> = { navy: "#2769a8", light: "#236a93", green: "#23866c", black: "#d68b3b" };
  const accent = accents[theme];
  return html
    .replace("<body>", `<body class="theme-${theme}">`)
    .replace("</style>", `.theme-${theme} .eyebrow,.theme-${theme} h2{color:${accent}}.theme-${theme} header{border-color:${accent}}.theme-${theme} .record-card{border-top-color:${accent}}</style>`);
}

export function WorkflowReportDialog({
  locale,
  open,
  workflowKey,
  recordKey,
  onClose,
  onSaved,
  theme,
}: WorkflowReportDialogProps) {
  const customerRelations = "customerRelations";
  const [workflow, setWorkflow] = useState(workflowKey);
  const [record, setRecord] = useState(recordKey);
  const [fields, setFields] = useState<ReportFieldValue[]>([]);
  const [context, setContext] = useState<ReportFieldValue[]>([]);
  const [previewHtml, setPreviewHtml] = useState("");
  const [stage, setStage] = useState<"form" | "preview">("form");
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [loadTemplate] = useGetReportTemplateQuery();
  const [loadStylesheet] = useGetReportStylesheetQuery();
  const [saveTemplate, saveState] = useSaveReportTemplateMutation();

  useEffect(() => {
    if (!open) return;
    setWorkflow(workflowKey);
    setRecord(recordKey);
    setFields([]);
    setContext([]);
    setPreviewHtml("");
    setStage("form");
    setError(null);
    setDownloadUrl(null);
      void loadFormData(workflowKey, recordKey);
  }, [open, workflowKey, recordKey, theme]);

  if (!open) return null;

  function parseFormData(xml: string): void {
    const document = new DOMParser().parseFromString(xml, "application/xml");
    const fieldNodes = Array.from(document.querySelectorAll("fields > field"));
    const firstRecord = document.querySelector("records > record");
    setFields(fieldNodes.map((field) => {
      const key = field.getAttribute("key") || "";
      return { key, value: firstRecord?.querySelector(`value[field='${key}']`)?.textContent || "" };
    }).filter((field) => field.key));
    setContext(Array.from(document.querySelectorAll("context > item")).map((item) => ({
      key: item.getAttribute("key") || "",
      value: item.textContent || "",
    })).filter((item) => item.key && item.value));
  }

  async function loadFormData(nextWorkflow: string, nextRecord: string): Promise<void> {
    try {
      const xml = await loadTemplate({ customerRelations, workflowKey: nextWorkflow, recordKey: nextRecord, theme }).unwrap();
      parseFormData(xml);
    } catch (cause) {
      setError(errorText(cause, translate(locale, "reportSaveFailed")));
    }
  }

  async function preview(): Promise<void> {
    try {
      setError(null);
      const [xml, stylesheet] = await Promise.all([
        loadTemplate({ customerRelations, workflowKey: workflow, recordKey: record, theme }).unwrap(),
        loadStylesheet().unwrap(),
      ]);
      parseFormData(xml);
      const xmlDocument = new DOMParser().parseFromString(xml, "application/xml");
      const xslDocument = new DOMParser().parseFromString(stylesheet, "application/xml");
      const processor = typeof XSLTProcessor === "undefined" ? null : new XSLTProcessor();
      if (!processor) {
        setPreviewHtml(fallbackHtml(xml));
      } else {
        processor.importStylesheet(xslDocument);
        const transformed = processor.transformToDocument(xmlDocument);
        setPreviewHtml(applyTheme(new XMLSerializer().serializeToString(transformed), theme));
      }
      setStage("preview");
    } catch (cause) {
      setError(errorText(cause, translate(locale, "reportSaveFailed")));
    }
  }

  async function save(): Promise<void> {
    try {
      setError(null);
      const result = await saveTemplate({
        customerRelations,
        workflowKey: workflow,
        recordKey: record,
        theme,
      }).unwrap();
      setDownloadUrl(result.download_url);
      await onSaved(result);
    } catch (cause) {
      setError(errorText(cause, translate(locale, "reportSaveFailed")));
    }
  }

  return (
    <div className="dialog-backdrop workflow-report-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="dialog-surface workflow-report-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="workflow-report-dialog__header">
          <div><span className="confirm-dialog__eyebrow">WORKFLOW ACTION</span><h2>{translate(locale, stage === "form" ? "reportTemplate" : "reportPreview")}</h2></div>
          <button type="button" className="workflow-message-dialog__close" onClick={onClose} disabled={saveState.isLoading}>×</button>
        </header>
        {stage === "form" ? (
          <div className="workflow-report-record-form">
            <div className="workflow-report-context">
              <h3>Workflow context</h3>
              {context.map((item) => <label key={item.key}><span>{item.key.replaceAll("_", " ")}</span><input value={item.value} readOnly /></label>)}
            </div>
            <div className="workflow-report-fields">
              <h3>{translate(locale, "reportDocumentFields")}</h3>
              {fields.map((field) => <label key={field.key}><span>{field.key.replaceAll("_", " ")}</span><input value={field.value} readOnly /></label>)}
              {!fields.length ? <p className="workflow-report-empty">No business-entity row is available for this step yet.</p> : null}
            </div>
          </div>
        ) : (
          <iframe className="workflow-report-preview" title={translate(locale, "reportPreview")} srcDoc={previewHtml} />
        )}
        {error ? <p className="workflow-message-error" role="alert">{error}</p> : null}
        {downloadUrl ? <a className="workflow-report-download" href={downloadUrl} target="_blank" rel="noreferrer">{translate(locale, "reportDownload")}</a> : null}
        <div className="dialog-actions workflow-message-dialog__actions">
          <button type="button" className="confirm-dialog__cancel workflow-message-dialog__button" onClick={stage === "preview" ? () => setStage("form") : onClose} disabled={saveState.isLoading}>
            <img src={cancelIcon} alt="" aria-hidden="true" />{stage === "preview" ? translate(locale, "reportTemplate") : translate(locale, "cancel")}
          </button>
          {stage === "form" ? (
            <button type="button" className="confirm-dialog__confirm workflow-message-dialog__button" onClick={() => void preview()}>
              <img src={saveIcon} alt="" aria-hidden="true" />OK
            </button>
          ) : (
            <button type="button" className="confirm-dialog__confirm workflow-message-dialog__button" onClick={() => void save()} disabled={saveState.isLoading}>
              <img src={saveIcon} alt="" aria-hidden="true" />{saveState.isLoading ? "…" : translate(locale, "save")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
