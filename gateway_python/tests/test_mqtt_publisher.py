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
