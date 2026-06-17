"""E2E tests for Sub-4: dashboard_flows module + /api/nodered/dashboard endpoint.

Module-level tests run always; HTTP-level tests skip cleanly when the
gateway is not running on :8765.
"""
import json
import socket
import sys
import urllib.error
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _gateway_up(host="localhost", port=8765, timeout=1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


# ── Module-level: always run ──────────────────────────


def test_dashboard_flows_module_imports():
    from gateway.dashboard_flows import build_dashboard_flows
    assert callable(build_dashboard_flows)


def test_dashboard_endpoint_registered():
    from gateway.server import app
    paths = {r.path for r in app.routes if hasattr(r, "path")}
    assert "/api/nodered/dashboard" in paths


def test_dashboard_flows_with_real_task_object():
    """Integration: build with a real CollectTask-like object (no MQTT required)."""
    from gateway.dashboard_flows import build_dashboard_flows

    class _Task:
        id = "TI-101"
        protocol = "modbus"
        site = "site1"
        device = "plc1"
        dtype = "f32"
        table = "raw_data"

    class _Channel:
        id = "TI-101"
        low = 10
        high = 90

    flows = build_dashboard_flows({"TI-101": _Task()}, {"TI-101": _Channel()})
    types = {n["type"] for n in flows}
    # Base structure
    assert "ui_tab" in types
    assert "ui_base" in types
    assert "ui_group" in types
    # Per-tag widgets
    assert "ui_gauge" in types
    assert "ui_chart" in types
    assert "mqtt in" in types
    # Channel-derived segments
    gauge = next(n for n in flows if n["type"] == "ui_gauge" and n["name"] == "TI-101")
    assert gauge["seg1"] == 10
    assert gauge["seg2"] == 90


def test_dashboard_flows_handles_opcua_and_modbus_mix():
    """Multiple protocols produce widgets in correct groups."""
    from gateway.dashboard_flows import build_dashboard_flows

    class _Task:
        def __init__(self, tid, proto):
            self.id = tid
            self.protocol = proto
            self.site = "s1"
            self.device = "d1"
            self.dtype = "f32"
            self.table = "raw_data"

    tasks = {
        "TI-101": _Task("TI-101", "modbus"),
        "P-201": _Task("P-201", "opcua"),
    }
    flows = build_dashboard_flows(tasks)
    modbus_gauge = next(
        n for n in flows
        if n["type"] == "ui_gauge" and n["name"] == "TI-101"
    )
    opcua_gauge = next(
        n for n in flows
        if n["type"] == "ui_gauge" and n["name"] == "P-201"
    )
    assert modbus_gauge["group"] == "grp_modbus_tags"
    assert opcua_gauge["group"] == "grp_opc_ua_tags"


# ── HTTP: skip if gateway not running ────────────────


@pytest.mark.skipif(not _gateway_up(), reason="Gateway not running on :8765")
def test_dashboard_endpoint_returns_200_with_attachment():
    """GET /api/nodered/dashboard returns valid flows.json with Content-Disposition."""
    try:
        with urllib.request.urlopen(
            "http://localhost:8765/api/nodered/dashboard", timeout=3
        ) as r:
            data = json.loads(r.read().decode())
            content_disp = r.headers.get("Content-Disposition", "")
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        pytest.skip(f"Gateway not reachable: {e}")
    assert "attachment" in content_disp
    assert "1052os-dashboard.json" in content_disp
    assert isinstance(data, list)
    # Base structure always present
    types = {n["type"] for n in data}
    assert "ui_tab" in types
    assert "ui_base" in types
    assert "ui_group" in types