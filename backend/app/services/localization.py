"""Locale normalization and JSONB master-data selection."""

from __future__ import annotations

from typing import Any

LOCALE_KEYS = {
    "en": "en",
    "en-US": "en",
    "en-GB": "en",
    "zh": "zh_CN",
    "zh-CN": "zh_CN",
    "zh_CN": "zh_CN",
    "zh-Hans": "zh_CN",
    "zh-HK": "zh_HK",
    "zh_HK": "zh_HK",
    "zh-TW": "zh_HK",
    "zh_TW": "zh_HK",
    "zh-Hant": "zh_HK",
}

COLLATIONS = {
    "en": "en_sort",
    "zh_CN": "zh_cn_sort",
    "zh_HK": "zh_hk_sort",
}


def locale_key(locale: str | None, default: str = "zh-CN") -> str:
    return LOCALE_KEYS.get(locale or default, LOCALE_KEYS.get(default, "zh_CN"))


def collation_for(locale: str | None) -> str:
    return COLLATIONS[locale_key(locale)]


def localized_value(
    translations: dict[str, Any] | None,
    locale: str | None,
    fallback: str = "",
) -> str:
    if not translations:
        return fallback
    key = locale_key(locale)
    candidates = (key, "zh_CN", "en", "zh_HK")
    for candidate in candidates:
        value = translations.get(candidate)
        if value not in (None, ""):
            return str(value)
    return fallback
