import type { HealthResponse, Locale, SessionInfo, ThemeMode } from "../types";
import { translate } from "../i18n/translations";

interface OrbitHeaderProps {
  locale: Locale;
  session: SessionInfo | undefined;
  health: HealthResponse | undefined;
  onLocaleChange: (locale: Locale) => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
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
}: OrbitHeaderProps) {
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
        <div className="runtime-chip" data-online={Boolean(health)}>
          <span className="runtime-chip__dot" />
          <div>
            <b>{health ? translate(locale, "encoding") : "API offline"}</b>
            <small>
              {health
                ? `${health.database} · ${health.timezone}`
                : "127.0.0.1:8120"}
            </small>
          </div>
        </div>

        {session ? (
          <div className="identity-chip">
            <span className="identity-chip__monogram">
              {session.display_name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <b>{session.display_name}</b>
              <small>
                {session.scope.department_name || session.scope.organization_name}
                {session.scope.laboratory_name
                  ? ` · ${session.scope.laboratory_name}`
                  : ""}
              </small>
            </div>
          </div>
        ) : null}

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

        <div className="theme-switch" aria-label="Theme">
          {(["light", "dark"] as ThemeMode[]).map((item) => (
            <button
              className={item === theme ? "is-active" : ""}
              key={item}
              onClick={() => onThemeChange(item)}
              type="button"
              aria-pressed={item === theme}
            >
              {item === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
