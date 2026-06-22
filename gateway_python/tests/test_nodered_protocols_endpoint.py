"""HTTP endpoints for Node-RED protocol library."""
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def mock_nodered():
    import gateway.server as srv
    from gateway.server import app

    fake = MagicMock()
    fake.is_running.return_value = True
    fake.list_flows.return_value = []
    fake.apply_flows.return_value = {"posted_to_nodered": True, "nodered_error": None, "count": 5}
    fake.gateway_api_url = "http://127.0.0.1:18765"
    fake.install_module.return_value = {"module": "node-red-contrib-modbus", "stdout": "ok"}
    with TestClient(app) as client:
        srv._nodered = fake
        try:
            yield fake, client
        finally:
            srv._nodered = None


def test_list_protocols_endpoint(mock_nodered):
    fake, client = mock_nodered
    r = client.get("/api/nodered/protocols")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "mqtt-subscribe" in [p["name"] for p in body["protocols"]]
    assert body["installed"] == []
    fake.list_flows.assert_called()


def test_install_protocol_endpoint_calls_apply(mock_nodered):
    fake, client = mock_nodered
    with patch("gateway.protocol_library.subprocess.run") as npm_probe:
        npm_probe.return_value = MagicMock(returncode=0)
        r = client.post("/api/nodered/protocols/mqtt-subscribe/install", json={"params": {"topic": "x/y"}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["protocol"] == "mqtt-subscribe"
    flows = fake.apply_flows.call_args.args[0]
    assert any(n.get("type") == "mqtt in" and n.get("topic") == "x/y" for n in flows)


def test_install_protocol_missing_module_returns_409(mock_nodered):
    _, client = mock_nodered
    with patch("gateway.protocol_library.subprocess.run", side_effect=Exception("missing")):
        r = client.post("/api/nodered/protocols/modbus-tcp-hr/install", json={"params": {}})
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "missing_module"


def test_install_protocol_module_endpoint(mock_nodered):
    fake, client = mock_nodered
    r = client.post("/api/nodered/protocols/modbus-tcp-hr/install-module", json={"module": "node-red-contrib-modbus"})
    assert r.status_code == 200
    assert r.json()["ok"] is True
    fake.install_module.assert_called_once_with("node-red-contrib-modbus")


def test_install_protocol_when_nodered_unavailable():
    from gateway.server import app
    with TestClient(app) as client:
        r = client.post("/api/nodered/protocols/mqtt-subscribe/install", json={"params": {}})
    assert r.status_code == 503
