import { useEffect, useState } from "react";

interface AuthUser {
  id: string;
  login_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  company_name: string;
  site: string;
  display_name: string;
  session_token?: string;
}

interface AuthDialogProps {
  open: boolean;
  locale: "en" | "zh-CN" | "zh-HK";
  onClose: () => void;
  onSignedIn: (user: AuthUser, token: string) => void;
}

type Registration = Omit<AuthUser, "id" | "display_name" | "session_token">;

export function AuthDialog({ open, locale, onClose, onSignedIn }: AuthDialogProps) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [selected, setSelected] = useState("");
  const [login, setLogin] = useState("");
  const [mode, setMode] = useState<"sign-in" | "register">("sign-in");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [devCode, setDevCode] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [registration, setRegistration] = useState<Registration>({
    login_name: "",
    first_name: "",
    last_name: "",
    email: "",
    phone_number: "",
    company_name: "",
    site: "Beijing(北京)",
  });

  const text = locale === "en"
    ? { title: "Sign in", user: "Account", send: "Send SMS code", verify: "Verify code", register: "Sign up", first: "First name", last: "Last name", email: "Email", phone: "Phone number", company: "Company", code: "Security code", mock: "Development SMS code", close: "Close" }
    : { title: "登录", user: "账户", send: "发送短信验证码", verify: "验证验证码", register: "注册", first: "名", last: "姓", email: "邮箱", phone: "手机号", company: "公司", code: "安全验证码", mock: "开发模式短信验证码", close: "关闭" };

  useEffect(() => {
    if (!open) return;
    setError("");
    setChallengeId(null);
    setCode("");
    setMode("sign-in");
    Promise.all([
      fetch("/api/v1/auth/users").then(readJson),
      fetch("/api/v1/auth/current-account").then(readJson),
    ])
      .then(([usersResponse, current]) => {
        const active = (usersResponse.users || []) as AuthUser[];
        setUsers(active);
        const preferred = active.find((user) => user.login_name === current.login) || active[0];
        if (preferred) {
          setSelected(preferred.id);
          setLogin(preferred.login_name);
        } else {
          setLogin(current.login || "");
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [open]);

  if (!open) return null;

  function chooseUser(id: string) {
    setSelected(id);
    const user = users.find((item) => item.id === id);
    if (user) setLogin(user.login_name);
    setChallengeId(null);
    setDevCode("");
  }

  async function sendSms() {
    setBusy(true);
    setError("");
    try {
      const user = users.find((item) => item.id === selected);
      const response = await fetch("/api/v1/auth/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: user?.login_name || login }),
      });
      const data = await readJson(response);
      setChallengeId(data.challenge_id);
      setPhone(data.phone_number || "");
      setDevCode(data.dev_code || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registration),
      });
      const data = await readJson(response);
      setUsers((current) => [...current, data.user]);
      setSelected(data.user.id);
      setLogin(data.user.login_name);
      setMode("sign-in");
      await sendSmsFor(data.user.login_name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function sendSmsFor(nextLogin: string) {
    const response = await fetch("/api/v1/auth/send-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: nextLogin }),
    });
    const data = await readJson(response);
    setChallengeId(data.challenge_id);
    setPhone(data.phone_number || "");
    setDevCode(data.dev_code || "");
  }

  async function verify() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/auth/verify-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge_id: challengeId, code, login }),
      });
      const data = await readJson(response);
      localStorage.setItem("orbit:auth-token", data.session_token);
      onSignedIn(data.user as AuthUser, data.session_token as string);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, key: keyof Registration, type = "text") => (
    <label className="auth-field">
      <span>{label}</span>
      <input
        type={type}
        value={registration[key]}
        onChange={(event) => setRegistration((current) => ({ ...current, [key]: event.target.value }))}
        disabled={busy}
      />
    </label>
  );

  return (
    <div className="auth-backdrop" role="presentation">
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-label={text.title}>
        <div className="auth-dialog__header">
          <h2>{text.title}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label={text.close}>×</button>
        </div>
        {mode === "sign-in" ? (
          <label className="auth-field">
            <span>{text.user}</span>
            <select value={selected} onChange={(event) => chooseUser(event.target.value)} disabled={busy || Boolean(challengeId)}>
              {users.map((user) => <option value={user.id} key={user.id}>{user.display_name} ({user.login_name})</option>)}
            </select>
          </label>
        ) : (
          <>
            {field(text.first, "first_name")}
            {field(text.last, "last_name")}
            {field(text.email, "email", "email")}
            {field(text.phone, "phone_number", "tel")}
            {field(text.company, "company_name")}
            {field(text.user, "login_name")}
          </>
        )}
        {challengeId ? (
          <>
            <p className="auth-message">SMS sent to {phone}</p>
            {devCode ? <p className="auth-message">{text.mock}: <code>{devCode}</code></p> : null}
            <label className="auth-field"><span>{text.code}</span><input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" /></label>
          </>
        ) : null}
        {error ? <p className="auth-error">{error}</p> : null}
        <div className="auth-dialog__actions">
          <button type="button" className="auth-button auth-button--secondary" onClick={() => { setMode(mode === "sign-in" ? "register" : "sign-in"); setChallengeId(null); }} disabled={busy}>
            {mode === "sign-in" ? text.register : text.title}
          </button>
          <button type="button" className="auth-button" onClick={() => void (challengeId ? verify() : mode === "register" ? register() : sendSms())} disabled={busy || (mode === "sign-in" && !selected) || Boolean(challengeId && !code.trim())}>
            {challengeId ? text.verify : mode === "register" ? text.register : text.send}
          </button>
        </div>
      </section>
    </div>
  );
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { detail: text }; }
  if (!response.ok) throw new Error(String(data.detail || data.error || `HTTP ${response.status}`));
  return data;
}
