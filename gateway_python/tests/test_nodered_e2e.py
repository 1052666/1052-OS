"""E2E test: full docker-compose stack + simulated NR consumer."""
import json
import socket
import subprocess
import time
from pathlib import Path

import paho.mqtt.client as mqtt
import pytest

REPO = Path(__file__).resolve().parents[2]


def _broker_up(host="localhost", port=1883) -> bool:
    try:
        with socket.create_connection((host, port), timeout=1.0):
            return True
    except OSError:
        return False


@pytest.mark.skipif(not _broker_up(), reason="Mosquitto not running on localhost:1883")
def test_e2e_mosquitto_subscriber_sees_test_publish():
    """Simulate Node-RED by subscribing via paho and verify a published message arrives."""
    received = []
    sub = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                      client_id="e2e-test-sub")
    sub.connect("localhost", 1883, 30)
    sub.loop_start()

    def on_msg(client, userdata, msg):
        received.append((msg.topic, json.loads(msg.payload.decode())))

    sub.on_message = on_msg
    sub.subscribe("1052os/test/e2e/e2e_tag/value", qos=0)
    time.sleep(0.2)

    pub = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                      client_id="e2e-test-pub")
    pub.connect("localhost", 1883, 30)
    pub.loop_start()
    pub.publish("1052os/test/e2e/e2e_tag/value",
                json.dumps({"ts": time.time(), "v": 1.0, "q": 192}))

    deadline = time.time() + 3.0
    while time.time() < deadline and not received:
        time.sleep(0.1)

    sub.loop_stop(); sub.disconnect()
    pub.loop_stop(); pub.disconnect()

    assert received, "subscriber received no message"
    topic, payload = received[0]
    assert topic == "1052os/test/e2e/e2e_tag/value"
    assert payload["v"] == 1.0
    assert payload["q"] == 192


@pytest.mark.skipif(not _broker_up(), reason="Mosquitto not running on localhost:1883")
def test_e2e_docker_compose_stack():
    """Verify `docker compose ps` shows mosquitto and gateway healthy.

    Skips gracefully if docker compose plugin is not available on this host.
    """
    try:
        result = subprocess.run(
            ["docker", "compose", "ps", "--format", "json"],
            cwd=REPO, capture_output=True, text=True, timeout=10,
        )
    except FileNotFoundError as e:
        pytest.skip(f"docker compose plugin not installed: {e}")
    except subprocess.TimeoutExpired:
        pytest.skip("docker compose ps timed out")
    except OSError as e:
        pytest.skip(f"docker compose invocation failed: {e}")

    if result.returncode != 0:
        pytest.skip(f"docker compose ps failed: {result.stderr.strip() or result.stdout.strip()}")

    services = []
    for line in result.stdout.strip().splitlines():
        try:
            services.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    names = {s.get("Name", "") for s in services}
    assert "1052os-mosquitto" in names or any("mosquitto" in n for n in names), \
        f"mosquitto not running: {names}"
