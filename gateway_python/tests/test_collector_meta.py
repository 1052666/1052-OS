import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.collector import CollectTask


def test_collecttask_site_default():
    t = CollectTask(id="440001", protocol="modbus", table="raw_data")
    d = t.to_dict()
    assert d["site"] == "default"
    assert d["device"] == "raw_data"  # default device = table name


def test_collecttask_from_dict_preserves_site():
    t = CollectTask.from_dict({
        "id": "440001", "protocol": "modbus",
        "site": "site1", "device": "plc1", "table": "raw_data",
    })
    assert t.site == "site1"
    assert t.device == "plc1"


def test_collecttask_to_dict_roundtrip():
    t = CollectTask(id="440001", protocol="modbus", site="site1", device="plc1", table="raw_data")
    d = t.to_dict()
    t2 = CollectTask.from_dict(d)
    assert t2.site == "site1"
    assert t2.device == "plc1"


def test_collecttask_mqtt_defaults():
    """MQTT fields default to safe empty / disabled values."""
    t = CollectTask(id="TEMP", protocol="mqtt", table="raw_data",
                    mq_topic="device/temperature")
    assert t.mq_broker_host == "127.0.0.1"
    assert t.mq_broker_port == 1883
    assert t.mq_topic == "device/temperature"
    assert t.mq_qos == 0
    assert t.mq_payload == "raw"
    assert t.mq_field == "v"
    assert t.mq_username is None
    assert t.mq_password is None


def test_collecttask_mqtt_to_from_dict_roundtrip():
    """MQTT source fields survive to_dict/from_dict serialization."""
    t = CollectTask(
        id="TEMP", protocol="mqtt", table="raw_data",
        site="site1", device="plc1",
        mq_broker_host="192.168.10.254", mq_broker_port=1883,
        mq_username="mqtt_user", mq_password="mqtt123456",
        mq_topic="device/temperature", mq_qos=1,
        mq_payload="json", mq_field="v",
        interval=2.0,
    )
    d = t.to_dict()
    t2 = CollectTask.from_dict(d)
    assert t2.protocol == "mqtt"
    assert t2.mq_broker_host == "192.168.10.254"
    assert t2.mq_broker_port == 1883
    assert t2.mq_username == "mqtt_user"
    assert t2.mq_password == "mqtt123456"
    assert t2.mq_topic == "device/temperature"
    assert t2.mq_qos == 1
    assert t2.mq_payload == "json"
    assert t2.mq_field == "v"
    assert t2.interval == 2.0
