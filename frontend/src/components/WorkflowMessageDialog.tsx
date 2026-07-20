import { useState } from "react";

import cancelIcon from "../assets/cancel-icon.svg";
import saveIcon from "../assets/save-icon.svg";
import type { Locale } from "../types";
import { translate } from "../i18n/translations";

interface WorkflowMessageDialogProps {
  locale: Locale;
  messages: string[];
  busy?: boolean;
  onSave: (message: string) => Promise<void>;
  onClose: () => void;
}

export function WorkflowMessageDialog({ locale, messages, busy = false, onSave, onClose }: WorkflowMessageDialogProps) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    const trimmed = message.trim();
    if (!trimmed) {
      setError(translate(locale, "messageRequired"));
      return;
    }
    try {
      setError(null);
      await onSave(trimmed);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : translate(locale, "messageSaveFailed"));
    }
  }

  return (
    <div className="dialog-backdrop workflow-message-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog-surface workflow-message-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-message-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="workflow-message-dialog__header">
          <div>
            <span className="confirm-dialog__eyebrow">WORKFLOW NOTE</span>
            <h2 id="workflow-message-title">{translate(locale, "addMessage")}</h2>
          </div>
          <button type="button" className="workflow-message-dialog__close" onClick={onClose} disabled={busy} aria-label={translate(locale, "cancel")}>×</button>
        </div>
        {messages.length ? (
          <div className="workflow-message-list" aria-label={translate(locale, "messages")}>
            {messages.map((item, index) => <p key={`${index}-${item}`}>{item}</p>)}
          </div>
        ) : null}
        <label className="workflow-message-field">
          <span>{translate(locale, "message")}</span>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} autoFocus rows={4} />
        </label>
        {error ? <p className="workflow-message-error" role="alert">{error}</p> : null}
        <div className="dialog-actions workflow-message-dialog__actions">
          <button type="button" className="confirm-dialog__cancel workflow-message-dialog__button" onClick={onClose} disabled={busy}>
            <img src={cancelIcon} alt="" aria-hidden="true" />
            {translate(locale, "cancel")}
          </button>
          <button type="button" className="confirm-dialog__confirm workflow-message-dialog__button" onClick={() => void save()} disabled={busy || !message.trim()}>
            <img src={saveIcon} alt="" aria-hidden="true" />
            {busy ? "…" : translate(locale, "save")}
          </button>
        </div>
      </section>
    </div>
  );
}
