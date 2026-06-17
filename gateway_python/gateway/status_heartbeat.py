"""
1052-OS Industrial Gateway — Status Heartbeat
Publishes gateway health snapshot to 1052os/events/status every 5s (background thread).
"""
import logging
import threading
from datetime import datetime, timezone

log = logging.getLogger("gateway.status_heartbeat")


class StatusHeartbeat:
    """Thread-based heartbeat that publishes gateway health snapshot every `interval` seconds."""

    def __init__(self, mqtt_publisher, get_health_fn, interval: float = 5.0):
        self.mqtt_publisher = mqtt_publisher
        self.get_health_fn = get_health_fn
        self.interval = interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="status-heartbeat")
        self._thread.start()

    def stop(self, timeout: float = 2.0):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=timeout)

    def _run(self):
        while not self._stop.is_set():
            try:
                if self.mqtt_publisher and self.mqtt_publisher.is_connected:
                    h = self.get_health_fn()
                    payload = {
                        "ts": datetime.now(timezone.utc).timestamp(),
                        "gateway": "up",
                        "broker": "connected",
                        "td": "connected" if h.get("tdengine") else "disconnected",
                        "modbus": "connected" if h.get("modbus") else "disconnected",
                        "opcua": "connected" if h.get("opcua") else "disconnected",
                        "mqtt": "connected" if h.get("mqtt") else "disconnected",
                        "collector_tasks": h.get("collector_tasks", 0),
                    }
                    self.mqtt_publisher.publish_event("status", "", payload)
            except Exception as e:
                log.warning(f"status_heartbeat error: {e}")
            self._stop.wait(self.interval)
