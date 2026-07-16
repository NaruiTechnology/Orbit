import type { Locale } from "../types";
import { translate } from "../i18n/translations";

interface ApiErrorProps {
  locale: Locale;
  onRetry: () => void;
}

export function ApiError({ locale, onRetry }: ApiErrorProps) {
  return (
    <div className="api-error" role="alert">
      <span>503</span>
      <div>
        <b>{translate(locale, "apiUnavailable")}</b>
        <small>FastAPI · 127.0.0.1:8120</small>
      </div>
      <button type="button" onClick={onRetry}>
        {translate(locale, "retry")}
      </button>
    </div>
  );
}

