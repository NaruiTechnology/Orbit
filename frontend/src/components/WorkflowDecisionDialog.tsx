import { useEffect, useState } from "react";

import cancelIcon from "../assets/cancel-icon.svg";
import saveIcon from "../assets/save-icon.svg";
import type { Locale, WorkflowDecisionCatalog, WorkflowRecord } from "../types";

interface WorkflowDecisionDialogProps {
  locale: Locale;
  record: WorkflowRecord;
  catalogs: WorkflowDecisionCatalog[];
  onClose: () => void;
  onGoto: (workflowKey: string, stepKey: string) => void;
}

export function WorkflowDecisionDialog({ locale, record, catalogs, onClose, onGoto }: WorkflowDecisionDialogProps) {
  const [catalogKey, setCatalogKey] = useState("");
  const [stepKey, setStepKey] = useState("");
  const selectedCatalog = catalogs.find((catalog) => catalog.key === catalogKey);

  useEffect(() => {
    setCatalogKey("");
    setStepKey("");
  }, [record.id]);

  function cancel(): void {
    setCatalogKey("");
    setStepKey("");
    onClose();
  }

  return (
    <div className="dialog-backdrop workflow-decision-backdrop" role="presentation" onMouseDown={cancel}>
      <section className="dialog-surface workflow-decision-dialog" role="dialog" aria-modal="true" aria-labelledby="workflow-decision-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="workflow-report-dialog__header">
          <div>
            <span className="confirm-dialog__eyebrow">WORKFLOW DECISION</span>
            <h2 id="workflow-decision-title">{locale === "en" ? "Choose the next workflow" : "选择下一步工作流"}</h2>
          </div>
          <button type="button" className="workflow-message-dialog__close" onClick={cancel} aria-label={locale === "en" ? "Close" : "关闭"}>×</button>
        </header>
        <div className="workflow-decision-dialog__body">
          <div className="workflow-decision-record workflow-decision-record--disabled" aria-disabled="true">
            <h3>{locale === "en" ? "Current order" : "当前订单"}</h3>
            <div className="workflow-decision-record__list">
              {Object.entries(record.values).map(([key, value]) => (
                <div className="workflow-decision-record__item" key={key}>
                  <span>{key.replaceAll("_", " ")}</span>
                  <b>{value === null || value === undefined || value === "" ? "—" : String(value)}</b>
                </div>
              ))}
            </div>
          </div>
          <label className="grid-edit-field">
            <span>{locale === "en" ? "Workflow catalog" : "工作流目录"}</span>
            <select value={catalogKey} onChange={(event) => { setCatalogKey(event.target.value); setStepKey(""); }}>
              <option value="">{locale === "en" ? "Select a catalog" : "选择目录"}</option>
              {catalogs.map((catalog) => <option key={catalog.key} value={catalog.key}>{catalog.name}</option>)}
            </select>
          </label>
          {selectedCatalog ? (
            <label className="grid-edit-field">
              <span>{locale === "en" ? "Workflow step" : "工作流步骤"}</span>
              <select value={stepKey} onChange={(event) => setStepKey(event.target.value)}>
                <option value="">{locale === "en" ? "Select a step" : "选择步骤"}</option>
                {selectedCatalog.steps.map((step) => <option key={step.record_key} value={step.record_key}>{step.label}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        <footer className="dialog-actions workflow-message-dialog__actions">
          <button type="button" className="confirm-dialog__cancel workflow-message-dialog__button" onClick={cancel}>
            <img src={cancelIcon} alt="" aria-hidden="true" />{locale === "en" ? "Cancel" : "取消"}
          </button>
          <button type="button" className="confirm-dialog__confirm workflow-message-dialog__button" disabled={!catalogKey || !stepKey} onClick={() => onGoto(catalogKey, stepKey)}>
            <img src={saveIcon} alt="" aria-hidden="true" />{locale === "en" ? "Goto" : "前往"}
          </button>
        </footer>
      </section>
    </div>
  );
}
