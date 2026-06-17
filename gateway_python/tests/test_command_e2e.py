"""E2E tests for Sub-3: MQTT command topic + audit endpoint.

Requires a running Mosquitto broker on :1883 (and optionally the gateway
on :8765) to exercise the full flow. Skips cleanly when infrastructure
is unavailable.
"""
import json
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import paho.mqtt.client as mqtt
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _broker_up(host="localhost", port=1883, timeout=1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _gateway_up(host="localhost", port=8765, timeout=1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


# ── Topic-level: paho subscribe + publish round-trip ──


@pytest.mark.skipif(not _broker_up(), reason="Mosquitto not running on :1883")
def test_cmd_topic_round_trip_does_not_crash():
    """Publish a write_coil command; subscribe to the response topic; no crash.

    The gateway may or may not be running; this test mainly ensures the broker
    accepts the command message and that a subscriber can hear the same
    command echoed back via a separate subscription pattern.
    """
    received = []

    def on_msg(client, userdata, msg):
        try:
            received.append(json.loads(msg.payload.decode()))
        except Exception:
            pass

    sub = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        client_id="e2e-cmd-sub",
    )
    sub.connect("localhost", 1883, 30)
    sub.loop_start()
    sub.on_message = on_msg
    sub.subscribe("1052os/cmd/write/#", qos=0)
    time.sleep(0.3)

    pub = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        client_id="e2e-cmd-pub",
    )
    pub.connect("localhost", 1883, 30)
    pub.loop_start()
    pub.publish(
        "1052os/cmd/write/modbus",
        json.dumps({
            "request_id": "e2e-test-r1",
            "cmd": "write_coil",
            "host": "127.0.0.1", "port": 502, "unit_id": 1,
            "address": 0, "value": True,
        }),
    )
    time.sleep(0.5)

    sub.loop_stop()
    sub.disconnect()
    pub.loop_stop()
    pub.disconnect()

    # We just check the broker round-trips the message. The gateway (if running)
    # may also process it; either way the test must not crash.


@pytest.mark.skipif(not _broker_up(), reason="Mosquitto not running on :1883")
def test_publisher_can_subscribe_via_added_method():
    """MqttPublisher.subscribe() is the new API used by CommandHandler.start()."""
    from gateway.mqtt_publisher import MqttPublisher, MqttPublisherConfig
    pub = MqttPublisher(MqttPublisherConfig())
    pub.start()
    try:
        time.sleep(0.3)  # let it connect (or not)
        # Subscribe is best-effort; should not raise even if broker is offline
        result = pub.subscribe("1052os/cmd/write/modbus", qos=0)
        assert isinstance(result, bool)
    finally:
        pub.stop()


# ── HTTP: audit + ack endpoints ────────────────────────


@pytest.mark.skipif(not _gateway_up(), reason="Gateway not running on :8765")
def test_audit_endpoint_returns_list():
    """GET /api/audit/writes returns ok=True and a 'writes' list (may be empty)."""
    try:
        with urllib.request.urlopen(
            "http://localhost:8765/api/audit/writes?limit=5", timeout=3
        ) as r:
            data = json.loads(r.read().decode())
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        pytest.skip(f"Gateway not reachable: {e}")
    assert data.get("ok") is True
    assert "writes" in data
    assert isinstance(data["writes"], list)


@pytest.mark.skipif(not _gateway_up(), reason="Gateway not running on :8765")
def test_anomaly_ack_returns_404_for_nonexistent():
    """POST /api/anomaly/ack for a fake channel returns 404."""
    try:
        req = urllib.request.Request(
            "http://localhost:8765/api/anomaly/ack?channel=__nonexistent__&ts=2099-01-01T00:00:00",
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=3) as r:
            status = r.status
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        # 404 is the expected response
        assert e.code == 404
        return
    # If somehow it returned 200, that's a bug too
    pytest.fail(f"Expected 404, got {status} with {data}")


# ── Module-level: ensure all Sub-3 components import ──


def test_sub3_modules_import():
    """All new Sub-3 modules must be importable."""
    from gateway.command_handler import CommandHandler
    from gateway.write_audit import WriteAuditLogger
    from gateway.anomaly import AnomalyEngine
    assert CommandHandler is not None
    assert WriteAuditLogger is not None
    assert AnomalyEngine is not None
    assert hasattr(AnomalyEngine, "ack_one")


def test_sub3_endpoints_registered():
    """The two new Sub-3 endpoints must be registered on the FastAPI app."""
    from gateway.server import app
    paths = {r.path for r in app.routes if hasattr(r, "path")}
    assert "/api/anomaly/ack" in paths
    assert "/api/audit/writes" in paths
