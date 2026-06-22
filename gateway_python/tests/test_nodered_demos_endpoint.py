"""HTTP endpoints for demo flows."""
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def mock_nodered():
    """Patch _nodered on the running server. Use as a context manager."""
    import gateway.server as srv
    fake = MagicMock()
    fake.is_running.return_value = True
    fake.list_flows.return_value = []
    fake.apply_flows.return_value = {"written": True, "posted_to_nodered": True,
                                      "nodered_error": None, "count": 6}
    from gateway.server import app
    with TestClient(app) as client:
        # Lifespan has run and left _nodered = None (GATEWAY_DISABLE_NODERED=1).
        # Patch it now so the endpoint sees our mock.
        srv._nodered = fake
        try:
            yield fake, client
        finally:
            srv._nodered = None


def test_list_demos_endpoint(mock_nodered):
    fake, client = mock_nodered
    r = client.get("/api/nodered/demos")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    names = [d["name"] for d in body["demos"]]
    assert "mqtt-to-td" in names
    assert "http-to-td" in names
    assert body["installed"] == []  # mock returned []


def test_install_demo_endpoint_calls_apply(mock_nodered):
    fake, client = mock_nodered
    r = client.post("/api/nodered/demos/mqtt-to-td/install")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["demo"] == "mqtt-to-td"
    assert fake.apply_flows.called
    (args, _) = fake.apply_flows.call_args
    flows = args[0]
    assert any(n["type"] == "tab" and "mqtt" in n["label"] for n in flows)


def test_install_unknown_returns_404(mock_nodered):
    _, client = mock_nodered
    r = client.post("/api/nodered/demos/nope/install")
    assert r.status_code == 404


def test_install_when_nodered_unavailable():
    """No patch → _nodered stays None → endpoint returns 503."""
    from gateway.server import app
    with TestClient(app) as client:
        r = client.post("/api/nodered/demos/mqtt-to-td/install")
    assert r.status_code == 503


def test_list_demos_when_nodered_unavailable():
    from gateway.server import app
    with TestClient(app) as client:
        r = client.get("/api/nodered/demos")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["installed"] == []
    assert len(body["demos"]) >= 2