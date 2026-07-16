from app.config import PROJECT_ROOT, get_settings


def test_json_configuration_resolves_from_project_root() -> None:
    settings = get_settings()

    assert PROJECT_ROOT.name == "Orbit"
    assert settings.api_port == 8120
    assert settings.frontend_port == 5274
    assert settings.database.client_encoding == "UTF8"
    assert settings.database.timezone == "Asia/Shanghai"
    assert settings.workflow_catalog.is_file()
