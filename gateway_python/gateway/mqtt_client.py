"""
1052-OS Industrial Gateway — MQTT Protocol Client
"""

import time
import threading
from dataclasses import dataclass, field
from typing import Any, Callable

import paho.mqtt.client as mqtt


@dataclass
class MqttConfig:
    host: str = "127.0.0.1"
    port: int = 1883
    client_id: str = ""
    username: str | None = None
    password: str | None = None
    keepalive: int = 60
    topic_prefix: str = "1052os"

    def to_dict(self) -> dict:
        return {
            "host": self.host,
            "port": self.port,
            "client_id": self.client_id or "(auto)",
            "username": self.username,
            "password": "***" if self.password else None,
            "keepalive": self.keepalive,
            "topic_prefix": self.topic_prefix,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "MqttConfig":
        return cls(
            host=d.get("host", "127.0.0.1"),
            port=d.get("port", 1883),
            client_id=d.get("client_id", ""),
            username=d.get("username"),
            password=d.get("password"),
            keepalive=d.get("keepalive", 60),
            topic_prefix=d.get("topic_prefix", "1052os"),
        )


@dataclass
class MqttMessage:
    topic: str
    payload: str
    qos: int
    timestamp: float = field(default_factory=time.time)


class MqttClientWrapper:
    """MQTT client wrapper with message buffer and callback support."""

    def __init__(self, config: MqttConfig | None = None):
        self.config = config or MqttConfig()
        self._client: mqtt.Client | None = None
        self._messages: list[MqttMessage] = []
        self._max_messages = 200
        self._lock = threading.Lock()
        self._on_message_callback: Callable[[MqttMessage], None] | None = None

    def _on_connect(self, client, userdata, flags, rc, props=None):
        pass

    def _on_message(self, client, userdata, msg):
        m = MqttMessage(topic=msg.topic, payload=msg.payload.decode(errors="replace"), qos=msg.qos)
        with self._lock:
            self._messages.append(m)
            if len(self._messages) > self._max_messages:
                self._messages = self._messages[-self._max_messages:]
        if self._on_message_callback:
            self._on_message_callback(m)

    def connect(self) -> bool:
        self._client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=self.config.client_id or None,
        )
        self._client.on_connect = self._on_connect
        self._client.on_message = self._on_message

        if self.config.username:
            self._client.username_pw_set(self.config.username, self.config.password)

        self._client.connect(self.config.host, self.config.port, self.config.keepalive)
        self._client.loop_start()
        return True

    def disconnect(self):
        if self._client:
            self._client.loop_stop()
            self._client.disconnect()
            self._client = None

    @property
    def connected(self) -> bool:
        return self._client is not None and self._client.is_connected()

    # ── Publish ────────────────────────────────────────

    def publish(self, topic: str, payload: str, qos: int = 0, retain: bool = False):
        full_topic = f"{self.config.topic_prefix}/{topic}" if not topic.startswith(self.config.topic_prefix) else topic
        info = self._client.publish(full_topic, payload, qos=qos, retain=retain)
        info.wait_for_publish()
        return {"ok": True, "topic": full_topic, "mid": info.mid}

    # ── Subscribe ──────────────────────────────────────

    def subscribe(self, topic: str, qos: int = 0):
        full_topic = f"{self.config.topic_prefix}/{topic}" if not topic.startswith(self.config.topic_prefix) else topic
        result = self._client.subscribe(full_topic, qos=qos)
        return {"ok": True, "topic": full_topic, "result": str(result)}

    def unsubscribe(self, topic: str):
        full_topic = f"{self.config.topic_prefix}/{topic}" if not topic.startswith(self.config.topic_prefix) else topic
        self._client.unsubscribe(full_topic)

    # ── Message buffer ─────────────────────────────────

    def get_messages(self, limit: int = 50) -> list[dict]:
        with self._lock:
            msgs = self._messages[-limit:]
        return [
            {"topic": m.topic, "payload": m.payload, "qos": m.qos, "timestamp": m.timestamp}
            for m in msgs
        ]

    def clear_messages(self):
        with self._lock:
            self._messages.clear()

    def on_message(self, callback: Callable[[MqttMessage], None]):
        self._on_message_callback = callback

    def ping(self) -> dict:
        if not self._client or not self._client.is_connected():
            return {"ok": False, "message": "Not connected"}
        return {"ok": True, "message": "connected"}

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *args):
        self.disconnect()
