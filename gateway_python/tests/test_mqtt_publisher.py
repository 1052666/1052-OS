"""Unit tests for mqtt_publisher — no broker required for these."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.mqtt_publisher import MqttPublisher, MqttPublisherConfig


def test_topic_building_value():
    pub = MqttPublisher(MqttPublisherConfig(host="localhost", port=1883))
    assert pub._build_topic("site1", "plc1", "440001", "value") \
        == "1052os/site1/plc1/440001/value"


def test_topic_building_meta():
    pub = MqttPublisher(MqttPublisherConfig(host="localhost", port=1883))
    assert pub._build_topic("site1", "plc1", "440001", "meta") \
        == "1052os/site1/plc1/440001/meta"


def test_topic_building_anomaly():
    pub = MqttPublisher(MqttPublisherConfig(host="localhost", port=1883))
    assert pub._build_topic(None, None, "ch1", "anomaly") \
        == "1052os/events/anomaly/ch1"


def test_status_initial():
    pub = MqttPublisher(MqttPublisherConfig(host="localhost", port=1883))
    s = pub.status()
    assert s["broker"] == "disconnected"
    assert s["publish_count"] == 0
    assert s["publish_errors"] == 0
    assert s["last_topics"] == []


def test_publish_when_disconnected_returns_false():
    pub = MqttPublisher(MqttPublisherConfig(host="localhost", port=1883))  # not started
    ok = pub.publish("site1", "plc1", "440001", 3.14, ts=0.0, q=192)
    assert ok is False
    assert pub.status()["publish_errors"] == 1


# ---------------------------------------------------------------------------
# Live broker integration tests (skip gracefully if no broker on localhost:1883)
# ---------------------------------------------------------------------------
import json
import socket
import threading
import time
import uuid

import paho.mqtt.client as mqtt


def _broker_reachable(host="localhost", port=1883, timeout=1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _collect_messages(topic: str, timeout: float = 2.0) -> list[dict]:
    """Subscribe first, collect for `timeout` seconds, then return received messages."""
    received: list[dict] = []
    ready = threading.Event()

    def on_connect(client, userdata, flags, rc, props=None):
        if rc == 0:
            client.subscribe(topic, qos=0)
            ready.set()

    def on_message(client, userdata, msg):
        received.append({"topic": msg.topic, "payload": json.loads(msg.payload.decode())})

    sub = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"test-sub-{uuid.uuid4().hex[:8]}",
    )
    sub.on_connect = on_connect
    sub.on_message = on_message
    sub.connect("localhost", 1883, 30)
    sub.loop_start()
    assert ready.wait(timeout=2.0), "subscriber failed to connect"
    time.sleep(timeout)
    sub.loop_stop()
    sub.disconnect()
    return received


def _collect_while_running(topic: str, action, settle: float = 1.0) -> list[dict]:
    """Subscribe, run `action()` while the subscriber is alive, then collect results."""
    received: list[dict] = []
    ready = threading.Event()

    def on_connect(client, userdata, flags, rc, props=None):
        if rc == 0:
            client.subscribe(topic, qos=0)
            ready.set()

    def on_message(client, userdata, msg):
        received.append({"topic": msg.topic, "payload": json.loads(msg.payload.decode())})

    sub = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"test-sub-{uuid.uuid4().hex[:8]}",
    )
    sub.on_connect = on_connect
    sub.on_message = on_message
    sub.connect("localhost", 1883, 30)
    sub.loop_start()
    assert ready.wait(timeout=2.0), "subscriber failed to connect"
    action()
    time.sleep(settle)  # let the broker deliver
    sub.loop_stop()
    sub.disconnect()
    return received


def test_publish_live_value_reaches_subscriber():
    if not _broker_reachable():
        import pytest
        pytest.skip("Mosquitto broker not reachable on localhost:1883")
    pub = MqttPublisher()
    pub.start()
    time.sleep(0.5)  # wait for connect
    assert pub.is_connected, "publisher failed to connect"
    topic = "1052os/site1/plc1/tag1/value"
    msgs = _collect_while_running(
        topic,
        action=lambda: pub.publish("site1", "plc1", "tag1", 42.0,
                                   ts=time.time(), q=192),
        settle=1.0,
    )
    assert len(msgs) >= 1, f"expected >=1 message on {topic}, got {msgs}"
    p = msgs[0]["payload"]
    assert set(p.keys()) == {"ts", "v", "q"}
    assert p["v"] == 42.0
    assert p["q"] == 192
    assert pub.status()["publish_count"] >= 1
    pub.stop()


def test_meta_is_retained():
    if not _broker_reachable():
        import pytest
        pytest.skip("Mosquitto broker not reachable on localhost:1883")
    pub = MqttPublisher()
    pub.start()
    time.sleep(0.5)
    pub.publish_meta("site1", "plc1", "tag1",
                     {"tag": "tag1", "dtype": "f32", "endian": "ABCD"},
                     retain=True)
    time.sleep(0.2)
    # Late subscriber should still receive the retained message.
    msgs = _collect_messages("1052os/site1/plc1/tag1/meta", timeout=1.5)
    assert any(m["payload"].get("dtype") == "f32" for m in msgs), \
        f"expected retained meta with dtype=f32, got {msgs}"
    pub.stop()
