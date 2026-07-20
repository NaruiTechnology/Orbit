import type { HealthResponse, Locale, SessionInfo, ThemeMode } from "../types";
import { translate } from "../i18n/translations";
import cogIcon from "../assets/cog-icon.svg";

interface OrbitHeaderProps {
  locale: Locale;
  session: SessionInfo | undefined;
  health: HealthResponse | undefined;
  onLocaleChange: (locale: Locale) => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onOpenAuth: () => void;
  onSignOut: () => void;
  onOpenAdmin: () => void;
}

const localeLabels: Record<Locale, string> = {
  en: "EN",
  "zh-CN": "简",
  "zh-HK": "繁",
};

export function OrbitHeader({
  locale,
  session,
  health,
  onLocaleChange,
  theme,
  onThemeChange,
  onOpenAuth,
  onSignOut,
  onOpenAdmin,
}: OrbitHeaderProps) {
  const canManageSystem = Boolean(session?.permissions.includes("administration.manage"));
  return (
    <header className="orbit-header">
      <div className="orbit-brand">
        <div className="orbit-mark" aria-hidden="true">
          <span />
          <i />
        </div>
        <div className="orbit-brand__copy">
          <div className="orbit-brand__line">
            <strong>IonbeamTech ORBIT</strong>
            <span>AUTOMATION</span>
          </div>
          <small>{translate(locale, "appSubtitle")}</small>
        </div>
      </div>

      <div className="orbit-header__meta">
        {canManageSystem ? (
          <button className="system-config-button" type="button" onClick={onOpenAdmin} aria-label="System Config" title="System Config">
            <img src={cogIcon} alt="" aria-hidden="true" />
          </button>
        ) : null}
        {session ? (
          <button className="identity-chip identity-chip--button" type="button" onClick={onSignOut} title="Sign out">
            <span className="identity-chip__monogram">
              {session.display_name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <b>{session.display_name}</b>
              <small className="identity-chip__context">
                {session.scope.department_name || session.scope.organization_name}
                {session.scope.laboratory_name
                  ? ` · ${session.scope.laboratory_name}`
                  : ""}
              </small>
              <small className="identity-chip__environment">
                {health ? `${health.database} · ${health.timezone}` : "API offline"}
              </small>
            </div>
          </button>
        ) : (
          <button className="identity-chip identity-chip--button" type="button" onClick={onOpenAuth}>
            <span className="identity-chip__monogram">?</span>
            <div>
              <b>Sign in</b>
              <small className="identity-chip__environment">
                {health ? `${health.database} · ${health.timezone}` : "API offline"}
              </small>
            </div>
          </button>
        )}

        <div className="locale-switch" aria-label="Language">
          {(Object.keys(localeLabels) as Locale[]).map((item) => (
            <button
              className={item === locale ? "is-active" : ""}
              key={item}
              onClick={() => onLocaleChange(item)}
              type="button"
              aria-pressed={item === locale}
            >
              {localeLabels[item]}
            </button>
          ))}
        </div>

        <div className="theme-switch">
          <select
            aria-label="Theme"
            value={theme}
            onChange={(event) => onThemeChange(event.target.value as ThemeMode)}
          >
            <option value="navy">Navy</option>
            <option value="light">Light</option>
            <option value="green">Green</option>
            <option value="black">Dark</option>
          </select>
        </div>
      </div>
    </header>
  );
}
