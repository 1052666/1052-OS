"""
1052-OS Industrial Gateway — Anomaly Detection Engine
Three detectors: threshold, step (rate-of-change), drift.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from gateway.tdengine_client import TdClient


@dataclass
class ChannelConfig:
    id: str = ""                     # e.g. "TI-101"
    table: str = "raw_data"          # TDengine table
    col: str = "v0"                  # column name
    low: float = 4.0                 # lower bound
    high: float = 20.0               # upper bound
    step_threshold: float = 2.0      # max delta between consecutive reads
    drift_threshold: float = 0.5     # max deviation from baseline
    drift_window: int = 20           # samples for drift calculation
    baseline: float | None = None    # auto-computed from recent data if None
    enabled: bool = True

    def to_dict(self) -> dict:
        return {
            "id": self.id, "table": self.table, "col": self.col,
            "low": self.low, "high": self.high,
            "step_threshold": self.step_threshold,
            "drift_threshold": self.drift_threshold,
            "drift_window": self.drift_window,
            "baseline": self.baseline, "enabled": self.enabled,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ChannelConfig":
        return cls(
            id=d.get("id", ""),
            table=d.get("table", "raw_data"),
            col=d.get("col", "v0"),
            low=d.get("low", 4.0),
            high=d.get("high", 20.0),
            step_threshold=d.get("step_threshold", 2.0),
            drift_threshold=d.get("drift_threshold", 0.5),
            drift_window=d.get("drift_window", 20),
            baseline=d.get("baseline"),
            enabled=d.get("enabled", True),
        )


@dataclass
class Anomaly:
    ts: datetime
    channel_id: str
    a_type: str      # "threshold" | "step" | "drift"
    severity: str     # "critical" | "warning"
    value: float
    threshold_val: float = 0.0
    message: str = ""

    def to_dict(self) -> dict:
        return {
            "ts": self.ts.isoformat(),
            "channel_id": self.channel_id,
            "type": self.a_type,
            "severity": self.severity,
            "value": self.value,
            "threshold": self.threshold_val,
            "message": self.message,
        }


class AnomalyEngine:
    """Industrial anomaly detection: threshold, step, drift."""

    def __init__(self, td: TdClient, mqtt_publisher=None):
        self.td = td
        self.mqtt_publisher = mqtt_publisher
        self.channels: dict[str, ChannelConfig] = {}
        self._ensure_log_table()

    def _ensure_log_table(self):
        self.td._exec(
            "CREATE STABLE IF NOT EXISTS anomaly_log "
            "(ts TIMESTAMP, a_type BINARY(16), severity BINARY(16), `value` DOUBLE, threshold_val DOUBLE, message BINARY(256)) "
            "TAGS (channel_id BINARY(64))"
        )

    # ── Config management ──────────────────────────────

    def set_channel(self, cfg: ChannelConfig):
        self.channels[cfg.id] = cfg

    def remove_channel(self, cid: str):
        self.channels.pop(cid, None)

    def get_channels(self) -> list[dict]:
        return [c.to_dict() for c in self.channels.values()]

    # ── Scan all channels ──────────────────────────────

    def scan(self) -> list[dict]:
        """Run all three detectors on all enabled channels."""
        results = []
        for cid, cfg in self.channels.items():
            if not cfg.enabled:
                continue
            results.extend(self._run_detectors(cfg))
        # Publish each anomaly to MQTT (Node-RED bridge) — only on scan(), NOT on scan_channel()
        if self.mqtt_publisher:
            for a in results:
                self.mqtt_publisher.publish_event(
                    "anomaly", a.channel_id,
                    {
                        "ts": a.ts.isoformat() if hasattr(a.ts, "isoformat") else a.ts,
                        "channel": a.channel_id,
                        "type": a.a_type,
                        "value": a.value,
                        "threshold": a.threshold_val,
                        "severity": a.severity,
                        "message": a.message,
                    },
                )
        return [a.to_dict() for a in results]

    def scan_channel(self, cid: str) -> list[dict]:
        if cid not in self.channels:
            return []
        cfg = self.channels[cid]
        return [a.to_dict() for a in self._run_detectors(cfg)]

    def _run_detectors(self, cfg: ChannelConfig) -> list[Anomaly]:
        anomalies = []
        now = datetime.now(timezone.utc)

        try:
            rows = self.td.query_latest(cfg.table, max(cfg.drift_window, 2))
        except Exception:
            return anomalies

        if len(rows) < 2:
            return anomalies

        values = [r.get(cfg.col) for r in rows if r.get(cfg.col) is not None]
        if not values:
            return anomalies

        latest = values[0]
        previous = values[1] if len(values) > 1 else latest

        # 1. Threshold check
        t_anomaly = self._check_threshold(cfg, latest, now)
        if t_anomaly:
            anomalies.append(t_anomaly)

        # 2. Step check
        s_anomaly = self._check_step(cfg, latest, previous, now)
        if s_anomaly:
            anomalies.append(s_anomaly)

        # 3. Drift check
        d_anomaly = self._check_drift(cfg, values, now)
        if d_anomaly:
            anomalies.append(d_anomaly)

        return anomalies

    def _check_threshold(self, cfg: ChannelConfig, val: float, ts: datetime) -> Anomaly | None:
        if val < cfg.low:
            return Anomaly(ts, cfg.id, "threshold", "critical", val, cfg.low,
                           f"{cfg.col} = {val:.3f} < low limit {cfg.low}")
        if val > cfg.high:
            return Anomaly(ts, cfg.id, "threshold", "critical", val, cfg.high,
                           f"{cfg.col} = {val:.3f} > high limit {cfg.high}")
        return None

    def _check_step(self, cfg: ChannelConfig, latest: float, prev: float, ts: datetime) -> Anomaly | None:
        delta = abs(latest - prev)
        if delta > cfg.step_threshold:
            return Anomaly(ts, cfg.id, "step", "warning", latest, cfg.step_threshold,
                           f"Δ = {delta:.3f} > step limit {cfg.step_threshold} (prev={prev:.3f})")
        return None

    def _check_drift(self, cfg: ChannelConfig, values: list[float], ts: datetime) -> Anomaly | None:
        n = min(len(values), cfg.drift_window)
        recent = values[:n]
        avg = sum(recent) / len(recent)

        baseline = cfg.baseline
        if baseline is None:
            baseline = avg
            cfg.baseline = baseline
            return None

        drift = abs(avg - baseline)
        if drift > cfg.drift_threshold:
            return Anomaly(ts, cfg.id, "drift", "warning", avg, baseline,
                           f"mean({n}samples)={avg:.3f} deviates from baseline {baseline:.3f} by {drift:.3f} > {cfg.drift_threshold}")
        return None

    # ── History ────────────────────────────────────────

    def get_history(self, channel_id: str = "", a_type: str = "", limit: int = 100) -> list[dict]:
        conds = []
        if channel_id:
            conds.append(f"channel_id = '{channel_id}'")
        if a_type:
            conds.append(f"a_type = '{a_type}'")
        where = f" WHERE {' AND '.join(conds)}" if conds else ""
        try:
            results = self.td._query(f"SELECT * FROM anomaly_log{where} ORDER BY ts DESC LIMIT {limit}")
            for r in results:
                if "a_type" in r:
                    r["type"] = r.pop("a_type")
                if "threshold_val" in r:
                    r["threshold"] = r.pop("threshold_val")
            return results
        except Exception:
            return []

    def get_history_count(self) -> int:
        try:
            r = self.td._query("SELECT COUNT(*) as cnt FROM anomaly_log")
            return r[0]["cnt"] if r else 0
        except Exception:
            return 0

    def clear_history(self):
        try:
            self.td._exec("DROP STABLE IF EXISTS anomaly_log")
            self._ensure_log_table()
        except Exception:
            pass

    def save_anomaly(self, a: Anomaly):
        try:
            table_name = f"a_{a.channel_id.replace('-','_').replace('.','_')}"
            sql = (
                f"CREATE TABLE IF NOT EXISTS {table_name} USING anomaly_log "
                f"TAGS ('{a.channel_id}')"
            )
            self.td._exec(sql)
            self.td._exec(
                f"INSERT INTO {table_name} (ts, a_type, severity, `value`, threshold_val, message) "
                f"VALUES ('{a.ts.isoformat()}', '{a.a_type}', '{a.severity}', {a.value}, {a.threshold_val}, '{a.message}')"
            )
        except Exception:
            pass
