interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="dialog-surface confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="confirm-dialog__eyebrow">CONFIRM ACTION</span>
        <h2 id="confirm-dialog-title">{title}</h2>
        <p>{message}</p>
        <div className="dialog-actions confirm-dialog__actions">
          <button type="button" className="confirm-dialog__cancel" disabled={busy} onClick={onCancel}>
            <svg className="grid-edit-action__icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
            {cancelLabel}
          </button>
          <button type="button" className="confirm-dialog__confirm" disabled={busy} onClick={onConfirm}>
            <svg className="grid-edit-action__icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
              <path d="M5 7h14M10 11v6m4-6v6M9 7V4h6v3m-9 0 1 13h8l1-13" />
            </svg>
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
