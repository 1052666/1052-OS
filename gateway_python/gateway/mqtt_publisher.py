"""
1052-OS Industrial Gateway — Mosquitto Publisher
Publishes collector values, tag metadata, anomaly events, and status heartbeats
to a local Mosquitto broker for Node-RED consumption.
"""
import json
import logging
import threading
from collections import deque
from dataclasses import dataclass
from typing import Any

import paho.mqtt.client as mqtt

log = logging.getLogger("gateway.mqtt_publisher")


@dataclass
class MqttPublisherConfig:
    host: str = "localhost"
    port: int = 1883
    client_id: str = "1052os-gateway"
    keepalive: int = 60
    prefix: str = "1052os"


class MqttPublisher:
    """Publisher-only paho-mqtt client with reconnect and counters."""

    def __init__(self, config: MqttPublisherConfig | None = None):
        self.config = config or MqttPublisherConfig()
        self._client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=self.config.client_id,
        )
        self._connected = False
        self._lock = threading.Lock()
        self._publish_count = 0
        self._publish_errors = 0
        self._last_publish_at: float | None = None
        self._last_error: str | None = None
        self._last_topics: deque[str] = deque(maxlen=5)
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect

    def _on_connect(self, client, userdata, flags, rc, props=None):
        self._connected = (rc == 0)
        if self._connected:
            log.info(f"MqttPublisher connected to {self.config.host}:{self.config.port}")
        else:
            log.warning(f"MqttPublisher connect failed rc={rc}")

    def _on_disconnect(self, client, userdata, flags, rc, props=None):
        self._connected = False
        log.warning(f"MqttPublisher disconnected rc={rc}")

    def start(self):
        """Open connection. Safe to call when broker is offline — reconnects automatically."""
        self._client.reconnect_delay_set(5, 60)
        try:
            self._client.connect_async(self.config.host, self.config.port, self.config.keepalive)
            self._client.loop_start()
        except Exception as e:
            log.warning(f"MqttPublisher start failed: {e}")

    def stop(self):
        try:
            self._client.loop_stop()
            self._client.disconnect()
        except Exception:
            pass
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    def _build_topic(self, site: str | None, device: str | None, tag: str, suffix: str) -> str:
        if suffix == "anomaly":
            return f"{self.config.prefix}/events/anomaly/{tag}"
        if suffix == "status":
            return f"{self.config.prefix}/events/status"
        return f"{self.config.prefix}/{site}/{device}/{tag}/{suffix}"

    def publish(
        self,
        site: str | None,
        device: str | None,
        tag: str,
        value: Any,
        ts: float,
        q: int = 192,
        retain: bool = False,
    ) -> bool:
        """Publish a value to the configured broker. Returns True on enqueue success."""
        if not self._connected:
            with self._lock:
                self._publish_errors += 1
                self._last_error = "broker disconnected"
            return False
        topic = self._build_topic(site, device, tag, "value")
        payload = json.dumps({"ts": ts, "v": value, "q": q}, ensure_ascii=False, default=str)
        try:
            info = self._client.publish(topic, payload, qos=0, retain=retain)
            if info.rc == mqtt.MQTT_ERR_SUCCESS:
                with self._lock:
                    self._publish_count += 1
                    self._last_publish_at = ts
                    self._last_topics.append(topic)
                return True
            with self._lock:
                self._publish_errors += 1
                self._last_error = f"publish rc={info.rc}"
            return False
        except Exception as e:
            with self._lock:
                self._publish_errors += 1
                self._last_error = str(e)
            log.warning(f"MqttPublisher publish failed: {e}")
            return False

    def publish_meta(self, site: str, device: str, tag: str, meta: dict, retain: bool = True) -> bool:
        topic = self._build_topic(site, device, tag, "meta")
        payload = json.dumps(meta, ensure_ascii=False, default=str)
        try:
            info = self._client.publish(topic, payload, qos=1, retain=retain)
            return info.rc == mqtt.MQTT_ERR_SUCCESS
        except Exception as e:
            log.warning(f"MqttPublisher publish_meta failed: {e}")
            return False

    def publish_event(self, event_type: str, channel: str, payload: dict) -> bool:
        topic = self._build_topic(None, None, channel, event_type)
        body = json.dumps(payload, ensure_ascii=False, default=str)
        try:
            info = self._client.publish(
                topic, body,
                qos=1 if event_type == "status" else 0,
                retain=(event_type == "status"),
            )
            return info.rc == mqtt.MQTT_ERR_SUCCESS
        except Exception as e:
            log.warning(f"MqttPublisher publish_event({event_type}) failed: {e}")
            return False

    def subscribe(self, topic: str, qos: int = 0) -> bool:
        """Subscribe to a topic. Used by Sub-3 CommandHandler to receive NR writes."""
        try:
            result = self._client.subscribe(topic, qos=qos)
            return result[0] == mqtt.MQTT_ERR_SUCCESS if isinstance(result, tuple) else True
        except Exception as e:
            log.warning(f"MqttPublisher subscribe({topic}) failed: {e}")
            return False

    def status(self) -> dict:
        with self._lock:
            return {
                "broker": "connected" if self._connected else "disconnected",
                "broker_host": f"{self.config.host}:{self.config.port}",
                "publish_count": self._publish_count,
                "publish_errors": self._publish_errors,
                "last_publish_at": self._last_publish_at,
                "last_error": self._last_error,
                "last_topics": list(self._last_topics),
            }
