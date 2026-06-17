"""E2E test: verify /api/nodered/flows endpoint returns valid flows.json."""
import json
import socket
from urllib import request, error

import pytest

GATEWAY_URL = "http://localhost:8765"


def _gateway_up(host="localhost", port=8765, timeout=1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


@pytest.mark.skipif(not _gateway_up(), reason="Gateway not running on :8765")
def test_endpoint_returns_200_and_attachment_header():
    try:
        req = request.Request(f"{GATEWAY_URL}/api/nodered/flows")
        with request.urlopen(req, timeout=5) as r:
            assert r.status == 200
            assert r.headers["Content-Type"].startswith("application/json")
            cd = r.headers.get("Content-Disposition", "")
            assert "attachment" in cd
            assert "1052os-flows.json" in cd
    except error.URLError as e:
        pytest.skip(f"Gateway not reachable: {e}")


@pytest.mark.skipif(not _gateway_up(), reason="Gateway not running on :8765")
def test_endpoint_body_is_valid_flows_array():
    try:
        with request.urlopen(f"{GATEWAY_URL}/api/nodered/flows", timeout=5) as r:
            data = json.loads(r.read().decode())
            assert isinstance(data, list)
            types = {n["type"] for n in data}
            assert "tab" in types
            assert "mqtt-broker" in types
    except error.URLError as e:
        pytest.skip(f"Gateway not reachable: {e}")
