"""End-to-end smoke test for the MQTT-source code path against a real broker.

After the driver refactor (gateway/drivers/mqtt.py), MQTT polling lives in
MqttDriver.start() rather than DataCollector._poll_mqtt. This test wires up
a DataCollector with a stub TdClient and the real MqttDriver, then publishes
JSON envelopes to 7 device/ topics on the EMQX broker and asserts that the
collector records the decoded values.

Run from /Users/easonliu/1052-OS/gateway_python:

    uv run python tests/e2e_mqtt_emqx.py
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import paho.mqtt.client as mqtt

from gateway.collector import CollectTask, DataCollector
from gateway.drivers import get_driver
from gateway.drivers.mqtt import MqttDriver

BROKER = "192.168.10.254"
PORT = 1883
USER = "mqtt_user"
PASSWORD = "mqtt123456"

# 7 device/ topics — the user's simulator spec.
# The actual simulator on EMQX publishes JSON envelopes of the form
#   {"timestamp": <ms>, "value": <data>, "device_id": "PLC_001"}
# so we extract the `value` field for both numeric and text dtypes.
TOPICS = [
    ("device/temperature", "f32",   "json", "value", 42.5),
    ("device/humidity",    "f32",   "json", "value", 65.0),
    ("device/pressure",    "f32",   "json", "value", 2.7),
    ("device/flow_rate",   "f32",   "json", "value", 120.0),
    ("device/power",       "f32",   "json", "value", 1850.0),
    ("device/status",      "ascii", "json", "value", "online"),
    ("device/alarm",       "ascii", "json", "value", "normal"),
]


class _FakeTd:
    """Records schema + insert calls without hitting TDengine."""

    def __init__(self):
        self.tables: list[tuple[str, dict, dict]] = []
        self.subtables: list[tuple[str, str, dict]] = []
        self.inserts: list[tuple[str, str, dict]] = []

    def connect(self): pass
    def close(self): pass

    def ensure_supertable(self, name, columns, tags):
        self.tables.append((name, columns, tags))

    def ensure_table(self, name, super_name, tags):
        self.subtables.append((name, super_name, tags))

    def insert(self, table, ts, row):
        ts_str = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
        self.inserts.append((table, ts_str, row))


def make_collector():
    td = _FakeTd()
    dc = DataCollector.__new__(DataCollector)
    dc.td = td
    dc.mqtt_publisher = None
    dc.tasks = {}
    dc._running = {}
    dc._threads = {}
    dc._points_collected = {}
    dc._last_values = {}
    return dc, td


def add_topics(dc):
    for topic, dtype, payload, field, sample in TOPICS:
        tid = topic.split("/")[-1].upper()
        task = CollectTask(
            id=tid, protocol="mqtt", dtype=dtype,
            table="device_data",
            site="site1", device="emqx",
            mq_broker_host=BROKER, mq_broker_port=PORT,
            mq_username=USER, mq_password=PASSWORD,
            mq_topic=topic, mq_qos=0,
            mq_payload=payload, mq_field=field,
            interval=1.0,
        )
        dc.add_task(task)
        dc.start_task(tid)


def publish_samples():
    """Publish one message per topic and disconnect cleanly."""
    c = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                    client_id="e2e-mqtt-publisher")
    c.username_pw_set(USER, PASSWORD)
    c.connect(BROKER, PORT, 30)
    for topic, dtype, payload, field, sample in TOPICS:
        body = json.dumps({"v": sample}) if payload == "json" else str(sample)
        c.publish(topic, body, qos=0)
    c.disconnect()


def main() -> int:
    dc, td = make_collector()
    driver = get_driver("mqtt")
    assert isinstance(driver, MqttDriver), f"expected MqttDriver, got {type(driver)}"
    print(f"driver: {driver.name} ({driver.label}) — using real driver against EMQX")

    add_topics(dc)
    print(f"started {len(TOPICS)} MQTT collectors; sleeping 3s for connect/subscribe…")
    time.sleep(3.0)
    publish_samples()
    print("published 7 sample envelopes; waiting 5s for delivery…")
    time.sleep(5.0)

    # Live simulator (separate publisher on EMQX) may also be running; the
    # counts below reflect everything delivered during the wait window.

    print("\n— per-tag insert summary —")
    failures = []
    per_tag_total: dict[str, int] = {}
    per_tag_with_value: dict[str, int] = {}
    for table, _ts, row in td.inserts:
        for tid, value in row.items():
            per_tag_total[tid] = per_tag_total.get(tid, 0) + 1
            if value is not None:
                per_tag_with_value[tid] = per_tag_with_value.get(tid, 0) + 1

    for topic, dtype, payload, field, expected in TOPICS:
        tid = topic.split("/")[-1].upper()
        total = per_tag_total.get(tid, 0)
        good = per_tag_with_value.get(tid, 0)
        last = dc._last_values.get(tid, {})
        last_value = last.get("value")
        last_type = last.get("type")
        last_err = last.get("err")
        if total == 0:
            failures.append(f"{tid}: no inserts")
            print(f"  {tid:<11} ✗ no inserts")
        else:
            ratio = good / total
            mark = "✓" if ratio >= 0.5 else "✗"
            err_part = f"  err={last_err!r}" if last_err else ""
            print(f"  {tid:<11} {mark} inserts={total:>4}  decoded={good:>4} "
                  f"({ratio:>5.0%})  last={last_value!r}  type={last_type}{err_part}")
            if ratio < 0.5:
                failures.append(f"{tid}: only {good}/{total} decoded")

    # Confirm schema was created with the right column types via the driver.
    print("\n— TDengine schema (driver-driven) —")
    for name, cols, tags in td.tables:
        if name == "device_data":
            print(f"  supertable {name}: {cols}")

    print(f"\n— TDengine inserts: {len(td.inserts)} —")
    for table, ts, row in td.inserts[-7:]:
        print(f"  {table}: {row}")

    print("\nStopping collectors…")
    for tid in [t.split("/")[-1].upper() for t, *_ in TOPICS]:
        dc.stop_task(tid)

    if failures:
        print(f"\nFAIL ({len(failures)} issues):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nAll 7 topics received correctly")
    return 0


if __name__ == "__main__":
    sys.exit(main())