from app.services.localization import collation_for, locale_key, localized_value


def test_locale_aliases_are_normalized() -> None:
    assert locale_key("zh-CN") == "zh_CN"
    assert locale_key("zh-TW") == "zh_HK"
    assert locale_key("en-US") == "en"


def test_localized_value_uses_predictable_fallback() -> None:
    translations = {"en": "Engineering", "zh_CN": "工程部"}

    assert localized_value(translations, "en") == "Engineering"
    assert localized_value(translations, "zh-HK") == "工程部"
    assert localized_value(None, "zh-CN", "fallback") == "fallback"


def test_collation_names_are_allowlisted() -> None:
    assert collation_for("en") == "en_sort"
    assert collation_for("zh-CN") == "zh_cn_sort"
    assert collation_for("zh-HK") == "zh_hk_sort"
