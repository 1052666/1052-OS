"""
1052-OS Industrial Gateway — Smart Report Generator
Integrates AnomalyEngine + TrendPredictor → structured analysis report.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from gateway.anomaly import AnomalyEngine
from gateway.predictor import TrendPredictor


@dataclass
class ChannelReport:
    channel_id: str
    table: str
    col: str
    health: int                # 0-100
    anomaly_count: int
    current_value: float | None
    trend_slope: float         # per second
    trend_r2: float
    trend_direction: str       # "rising" | "falling" | "stable"
    ttl_seconds: float | None  # time to limit crossing
    risk_level: str            # "safe" | "watch" | "warning" | "critical"

    def to_dict(self) -> dict:
        return {
            "channel_id": self.channel_id,
            "table": self.table,
            "col": self.col,
            "health": self.health,
            "anomaly_count": self.anomaly_count,
            "current_value": round(self.current_value, 4) if self.current_value else None,
            "trend_slope": round(self.trend_slope * 60, 6),  # per minute
            "trend_r2": round(self.trend_r2, 4),
            "trend_direction": self.trend_direction,
            "ttl_seconds": round(self.ttl_seconds, 1) if self.ttl_seconds else None,
            "risk_level": self.risk_level,
        }


@dataclass
class Report:
    generated_at: str
    system_health: int          # 0-100 overall
    total_channels: int
    active_channels: int
    anomaly_total: int
    anomaly_breakdown: dict[str, int]   # type -> count
    channel_reports: list[dict]
    recommendations: list[str]

    def to_dict(self) -> dict:
        return {
            "generated_at": self.generated_at,
            "system_health": self.system_health,
            "total_channels": self.total_channels,
            "active_channels": self.active_channels,
            "anomaly_total": self.anomaly_total,
            "anomaly_breakdown": self.anomaly_breakdown,
            "channel_reports": self.channel_reports,
            "recommendations": self.recommendations,
        }


class ReportGenerator:
    """Generates structured industrial analysis reports."""

    def __init__(self, anomaly: AnomalyEngine, predictor: TrendPredictor):
        self.anomaly = anomaly
        self.predictor = predictor

    def generate(self) -> dict:
        """Generate a full system health report."""
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()

        # ── 1. Collect channel data ─────────────────────
        channels = self.anomaly.get_channels()
        channel_reports: list[ChannelReport] = []
        anomaly_total = 0
        breakdown: dict[str, int] = {"threshold": 0, "step": 0, "drift": 0}

        for ch in channels:
            cid = ch["id"]
            table = ch["table"]
            col = ch["col"]

            # Anomalies for this channel
            raw = self.anomaly.scan_channel(cid)
            a_count = len(raw)
            anomaly_total += a_count
            for a in raw:
                t = a.get("type", "")
                if t in breakdown:
                    breakdown[t] += 1

            # Trend prediction
            try:
                trend = self.predictor.predict(table, col, window_seconds=600, horizon_seconds=600)
                ttl = self.predictor.time_to_threshold(table, col, ch.get("high", 20), window_seconds=600)
            except Exception:
                trend = None
                ttl = None

            slope = trend.slope if trend else 0
            r2 = trend.r_squared if trend else 0
            current = trend.current_value if trend else None
            direction = ttl.direction if ttl else "stable"
            ttl_sec = ttl.seconds_to_limit if ttl else None

            # ── 2. Channel health score (0-100) ──────────
            health = 100
            if a_count > 0:
                health -= min(a_count * 15, 40)   # each anomaly -15, max -40
            if r2 > 0.5 and abs(slope * 60) > 0.5:
                health -= 20                        # strong trend → risk
            if ttl_sec and ttl_sec < 3600:
                health -= 30                        # imminent threshold crossing
            health = max(0, health)

            # ── 3. Risk level ───────────────────────────
            if health >= 90:
                risk = "safe"
            elif health >= 70:
                risk = "watch"
            elif health >= 40:
                risk = "warning"
            else:
                risk = "critical"

            channel_reports.append(ChannelReport(
                channel_id=cid, table=table, col=col,
                health=health, anomaly_count=a_count,
                current_value=current, trend_slope=slope,
                trend_r2=r2, trend_direction=direction,
                ttl_seconds=ttl_sec, risk_level=risk,
            ))

        # ── 4. System health ────────────────────────────
        if channel_reports:
            sys_health = int(sum(c.health for c in channel_reports) / len(channel_reports))
        else:
            sys_health = 100

        # ── 5. Recommendations ─────────────────────────
        recs = self._generate_recommendations(channel_reports, breakdown, anomaly_total, sys_health)

        return Report(
            generated_at=now_iso,
            system_health=sys_health,
            total_channels=len(channels),
            active_channels=sum(1 for ch in channels if ch.get("enabled", True)),
            anomaly_total=anomaly_total,
            anomaly_breakdown=breakdown,
            channel_reports=[c.to_dict() for c in channel_reports],
            recommendations=recs,
        ).to_dict()

    def _generate_recommendations(self, channels: list[ChannelReport],
                                   breakdown: dict, total: int, sys_health: int) -> list[str]:
        recs = []

        # Overall
        if sys_health >= 90:
            recs.append("✅ 系统运行正常，所有通道处于安全状态。")
        elif sys_health >= 70:
            recs.append("⚠️ 系统整体健康度尚可，部分通道需关注。")
        elif sys_health >= 40:
            recs.append("🔶 系统存在中度风险，建议安排排查。")
        else:
            recs.append("🔴 系统风险较高，建议立即检修高危通道。")

        # Anomaly-based
        if breakdown.get("threshold", 0) > 0:
            recs.append(f"🔴 检测到 {breakdown['threshold']} 次越限告警，请检查对应变送器/传感器接线及量程设置。")
        if breakdown.get("step", 0) > 0:
            recs.append(f"⚠️ 检测到 {breakdown['step']} 次突变，可能为接线松动或电磁干扰，建议紧固端子并检查屏蔽接地。")
        if breakdown.get("drift", 0) > 0:
            recs.append(f"📈 检测到 {breakdown['drift']} 次漂移，传感器可能存在老化，建议校准或安排更换。")

        # Trend-based
        critical_channels = [c for c in channels if c.risk_level == "critical"]
        warning_channels = [c for c in channels if c.risk_level == "warning"]
        if critical_channels:
            names = ", ".join(c.channel_id for c in critical_channels)
            recs.append(f"🚨 高危通道 ({len(critical_channels)}): {names}，预计近期超限，请优先处理。")
        if warning_channels:
            names = ", ".join(c.channel_id for c in warning_channels)
            recs.append(f"⚠️ 预警通道 ({len(warning_channels)}): {names}，建议纳入下周巡检计划。")

        # No-anomaly positive
        if total == 0 and sys_health > 90:
            recs.append("📋 当前无异常告警，系统运行平稳，继续保持日常巡检即可。")

        return recs

    # ── History ─────────────────────────────────────────

    def save_report(self, report: dict):
        """Save report to TDengine report_log table."""
        try:
            self.anomaly.td._exec(
                "CREATE STABLE IF NOT EXISTS report_log "
                "(ts TIMESTAMP, system_health INT, total_channels INT, anomaly_total INT, "
                "summary BINARY(1024), full_json BINARY(8192)) "
                "TAGS (report_type BINARY(32))"
            )
            now = datetime.now(timezone.utc)
            table = f"r_{now.strftime('%Y%m%d_%H%M%S')}"
            summary = f"健康度={report['system_health']}, 通道={report['total_channels']}, 异常={report['anomaly_total']}"
            import json
            full = json.dumps(report, ensure_ascii=False)[:8000]
            self.anomaly.td._exec(
                f"CREATE TABLE IF NOT EXISTS {table} USING report_log TAGS ('auto')"
            )
            self.anomaly.td._exec(
                f"INSERT INTO {table} (ts, system_health, total_channels, anomaly_total, summary, full_json) "
                f"VALUES ('{now.isoformat()}', {report['system_health']}, {report['total_channels']}, "
                f"{report['anomaly_total']}, '{summary}', '{full}')"
            )
        except Exception:
            pass

    def get_history(self, limit: int = 20) -> list[dict]:
        try:
            rows = self.anomaly.td._query(
                f"SELECT ts, system_health, total_channels, anomaly_total, summary FROM report_log "
                f"ORDER BY ts DESC LIMIT {limit}"
            )
            return rows
        except Exception:
            return []

    def get_report(self, ts: str) -> dict | None:
        import json
        try:
            rows = self.anomaly.td._query(
                f"SELECT full_json FROM report_log WHERE ts = '{ts}' LIMIT 1"
            )
            if rows and rows[0].get("full_json"):
                return json.loads(rows[0]["full_json"])
            return None
        except Exception:
            return None
