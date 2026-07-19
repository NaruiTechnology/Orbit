import { useEditor, EditorContent } from "@tiptap/react";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useState } from "react";

import type { Locale } from "../types";
import { translate } from "../i18n/translations";

interface MailComposeDialogProps {
  locale: Locale;
  defaultSubject: string;
  onClose: () => void;
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("orbit:auth-token");
  return token ? { "X-Orbit-Auth": token } : {};
}

function openMailApp(to: string, subject: string, text: string): void {
  const params = new URLSearchParams({ subject, body: text });
  window.location.href = `mailto:${encodeURIComponent(to.trim())}?${params.toString()}`;
}

interface MailStatus {
  configured?: boolean;
  transport?: "smtp" | "mailto";
  html_supported?: boolean;
}

function containsHtmlMarkup(value: string): boolean {
  return /<\s*(html|body|table|thead|tbody|tfoot|tr|th|td|p|ul|ol|li|strong|em|br)\b/i.test(value);
}

export function MailComposeDialog({ locale, defaultSubject, onClose }: MailComposeDialogProps) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);
  const [mailTransport, setMailTransport] = useState<"smtp" | "mailto" | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: "<p></p>",
    immediatelyRender: false,
    editorProps: {
      handlePaste: (view, event) => {
        const plainText = event.clipboardData?.getData("text/plain") || "";
        if (!containsHtmlMarkup(plainText)) return false;
        const container = document.createElement("div");
        container.innerHTML = plainText;
        const slice = ProseMirrorDOMParser.fromSchema(view.state.schema).parseSlice(container);
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
  });

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/mail/status", { headers: authHeaders() })
      .then(async (response) => {
        if (!response.ok) return false;
        const status = await response.json() as MailStatus;
        setMailTransport(status.transport || (status.configured ? "smtp" : "mailto"));
        return status.configured === true;
      })
      .catch(() => false)
      .then((configured) => {
        if (active) setSmtpConfigured(configured);
      });
    return () => {
      active = false;
    };
  }, []);

  async function fallbackToMailApp(): Promise<void> {
    const text = editor?.getText() || "";
    openMailApp(to, subject, text);
    onClose();
  }

  async function send(): Promise<void> {
    const html = editor?.getHTML() || "";
    const text = editor?.getText() || "";
    if (!to.trim()) {
      setError(translate(locale, "emailAddress"));
      return;
    }
    if (!text.trim()) {
      setError(translate(locale, "messageBody"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const statusResponse = await fetch("/api/v1/mail/status", { headers: authHeaders() });
      const status = statusResponse.ok ? (await statusResponse.json() as MailStatus) : null;
      const configured = status?.configured === true;
      setSmtpConfigured(configured);
      setMailTransport(status?.transport || (configured ? "smtp" : "mailto"));
      if (!configured) {
        await fallbackToMailApp();
        return;
      }
      const response = await fetch("/api/v1/mail/send", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, text, html }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || "SMTP delivery failed");
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "SMTP delivery failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop mail-compose-backdrop" role="presentation">
      <section className="dialog-surface mail-compose-dialog" role="dialog" aria-modal="true" aria-labelledby="mail-compose-title">
        <div className="mail-compose-dialog__header">
          <div>
            <span className="confirm-dialog__eyebrow">ORBIT MAIL</span>
            <h2 id="mail-compose-title">{translate(locale, "composeEmail")}</h2>
          </div>
          <button type="button" className="mail-compose-dialog__close" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        {smtpConfigured === false ? (
          <p className="mail-compose-warning" role="status">{translate(locale, "smtpWarning")}</p>
        ) : null}
        {smtpConfigured === true ? (
          <p className="mail-compose-transport" role="status">SMTP · HTML delivery</p>
        ) : mailTransport === "mailto" ? (
          <p className="mail-compose-transport" role="status">Webmail · plain-text fallback</p>
        ) : null}
        <label className="mail-compose-field">
          <span>{translate(locale, "to")}</span>
          <input value={to} onChange={(event) => setTo(event.target.value)} placeholder="name@example.com" autoFocus />
        </label>
        <label className="mail-compose-field">
          <span>{translate(locale, "subject")}</span>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} />
        </label>
        <div className="mail-compose-field">
          <span>{translate(locale, "messageBody")}</span>
          <div className="mail-compose-editor-toolbar" aria-label="Formatting toolbar">
            <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()} className={editor?.isActive("bold") ? "is-active" : ""}>B</button>
            <button type="button" onClick={() => editor?.chain().focus().toggleItalic().run()} className={editor?.isActive("italic") ? "is-active" : ""}>I</button>
            <button type="button" onClick={() => editor?.chain().focus().toggleBulletList().run()} className={editor?.isActive("bulletList") ? "is-active" : ""}>• List</button>
            <button
              type="button"
              title="Convert pasted HTML markup into formatted content"
              onClick={() => {
                const raw = editor?.getText() || "";
                if (editor && containsHtmlMarkup(raw)) editor.commands.setContent(raw);
              }}
            >HTML</button>
          </div>
          <EditorContent editor={editor} className="mail-compose-editor" />
        </div>
        {error ? <p className="mail-compose-error" role="alert">{error}</p> : null}
        <div className="mail-compose-dialog__actions">
          <button type="button" className="mail-compose-secondary" onClick={() => void fallbackToMailApp()} disabled={busy || !to.trim()}>{translate(locale, "openMailApp")}</button>
          <button type="button" className="mail-compose-secondary" onClick={onClose} disabled={busy}>{translate(locale, "cancel")}</button>
          <button type="button" className="mail-compose-primary" onClick={() => void send()} disabled={busy}>{busy ? "…" : translate(locale, "send")}</button>
        </div>
      </section>
    </div>
  );
}
