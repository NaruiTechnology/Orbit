import cancelIcon from "../assets/cancel-icon.svg";
import saveIcon from "../assets/save-icon.svg";
import type { Locale } from "../types";
import { translate } from "../i18n/translations";

interface WorkflowReasonDialogProps {
  locale: Locale;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function WorkflowReasonDialog({ locale, value, onChange, onClose, onConfirm }: WorkflowReasonDialogProps) {
  return (
    <div className="dialog-backdrop workflow-reason-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog-surface workflow-reason-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-reason-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="confirm-dialog__eyebrow">WORKFLOW ACTION</span>
        <h2 id="workflow-reason-title">{translate(locale, "reason")}</h2>
        <label className="workflow-reason-field">
          <span>{translate(locale, "reason")}</span>
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoFocus
            rows={3}
          />
        </label>
        <div className="dialog-actions workflow-reason-dialog__actions">
          <button type="button" className="confirm-dialog__cancel workflow-message-dialog__button" onClick={onClose}>
            <img src={cancelIcon} alt="" aria-hidden="true" />
            {translate(locale, "cancel")}
          </button>
          <button type="button" className="confirm-dialog__confirm workflow-message-dialog__button" onClick={onConfirm} disabled={!value.trim()}>
            <img src={saveIcon} alt="" aria-hidden="true" />
            OK
          </button>
        </div>
      </section>
    </div>
  );
}
