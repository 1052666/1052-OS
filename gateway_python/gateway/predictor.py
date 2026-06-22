"""
1052-OS Industrial Gateway — Trend Prediction Engine
Least-squares linear regression on TDengine time-series data.
"""

from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any

from gateway.tdengine_client import TdClient


@dataclass
class TrendResult:
    slope: float                 # value change per second
    intercept: float             # value at epoch 0
    r_squared: float             # goodness of fit (0~1)
    samples: int                 # data points used
    current_value: float         # latest observed value
    predicted_value: float       # value at horizon
    horizon_seconds: float       # how far ahead predicted
    message: str = ""

    def to_dict(self) -> dict:
        return {
            "slope": round(self.slope, 6),
            "intercept": round(self.intercept, 4),
            "r_squared": round(self.r_squared, 4),
            "samples": self.samples,
            "current_value": round(self.current_value, 4),
            "predicted_value": round(self.predicted_value, 4),
            "horizon_seconds": self.horizon_seconds,
            "message": self.message,
        }


@dataclass
class ForecastPoint:
    ts: datetime
    value: float

    def to_dict(self) -> dict:
        return {"ts": self.ts.isoformat(), "value": round(self.value, 4)}


@dataclass
class TTLResult:
    limit: float                  # target threshold
    current_value: float
    slope_per_second: float
    seconds_to_limit: float | None  # None if never crosses
    eta: datetime | None
    direction: str                # "rising" | "falling" | "stable"
    message: str

    def to_dict(self) -> dict:
        return {
            "limit": self.limit,
            "current_value": round(self.current_value, 4),
            "slope_per_second": round(self.slope_per_second, 6),
            "seconds_to_limit": round(self.seconds_to_limit, 1) if self.seconds_to_limit else None,
            "eta": self.eta.isoformat() if self.eta else None,
            "direction": self.direction,
            "message": self.message,
        }


class TrendPredictor:
    """Linear regression trend prediction on TDengine data."""

    # ── Value below this means "trend is effectively flat" ──
    SLOPE_EPSILON = 1e-9

    def __init__(self, td: TdClient):
        self.td = td

    # ── Core regression ──────────────────────────────────

    def _fetch(self, table: str, col: str, window_seconds: float) -> list[tuple[float, float]]:
        """Return [(epoch_seconds, value), ...] sorted by time ascending."""
        rows = self.td.query_latest(table, 10000)
        if not rows:
            return []

        now_epoch = datetime.now(timezone.utc).timestamp()
        cutoff_epoch = now_epoch - window_seconds

        points: list[tuple[float, float]] = []
        for r in rows:
            v = r.get(col)
            if v is None:
                continue
            ts_str = r.get("ts", "")
            try:
                if isinstance(ts_str, datetime):
                    dt = ts_str
                else:
                    s = str(ts_str)
                    # TDengine format: '2026-06-13 14:59:23.671 +08:00'
                    s_clean = s.rsplit(' +', 1)[0] if ' +' in s else s
                    dt = datetime.strptime(s_clean, '%Y-%m-%d %H:%M:%S.%f')
                epoch = dt.timestamp()
                if epoch >= cutoff_epoch:
                    points.append((epoch, float(v)))
            except (ValueError, TypeError):
                continue
        points.sort(key=lambda p: p[0])
        return points

    def _fit(self, points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
        """Return (slope, intercept, r_squared, x_center).
        Regression is centered: y = slope*(x - x_center) + intercept."""
        n = len(points)
        if n < 2:
            return 0.0, (points[0][1] if n == 1 else 0.0), 0.0, points[0][0] if n else 0.0

        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        mean_x = sum(xs) / n
        mean_y = sum(ys) / n

        xs_centered = [x - mean_x for x in xs]
        ss_xy = sum(xc * (y - mean_y) for xc, y in zip(xs_centered, ys))
        ss_xx = sum(xc ** 2 for xc in xs_centered)
        ss_yy = sum((y - mean_y) ** 2 for y in ys)

        if abs(ss_xx) < self.SLOPE_EPSILON:
            return 0.0, mean_y, 0.0, mean_x

        slope = ss_xy / ss_xx
        intercept = mean_y  # At x=mean_x, y=mean_y

        # R²
        if ss_yy < self.SLOPE_EPSILON:
            r2 = 1.0
        else:
            ss_res = sum((y - (slope * (x - mean_x) + mean_y)) ** 2 for x, y in zip(xs, ys))
            r2 = max(0.0, 1.0 - ss_res / ss_yy)

        return slope, intercept, r2, mean_x

    # ── Public API ──────────────────────────────────────

    def predict(self, table: str, col: str, window_seconds: float = 300,
                horizon_seconds: float = 300) -> TrendResult:
        """Predict value at `horizon_seconds` from now."""
        points = self._fetch(table, col, window_seconds)
        if len(points) < 2:
            return TrendResult(0, 0, 0, len(points), 0, 0, horizon_seconds, "数据不足，无法预测")

        slope, intercept, r2, x_center = self._fit(points)
        current = points[-1][1]
        now_epoch = datetime.now(timezone.utc).timestamp()
        future_epoch = now_epoch + horizon_seconds
        predicted = slope * (future_epoch - x_center) + intercept

        # Build human message
        dir_word = "上升" if slope > 1e-6 else ("下降" if slope < -1e-6 else "平稳")
        slope_per_min = slope * 60
        msg = f"{dir_word}趋势: {slope_per_min:+.4f}/min, R²={r2:.3f}, "
        msg += f"当前{current:.3f} → {horizon_seconds:.0f}秒后预计{predicted:.3f}"

        return TrendResult(slope, intercept, r2, len(points), current, predicted, horizon_seconds, msg)

    def forecast(self, table: str, col: str, window_seconds: float = 300,
                 horizon_seconds: float = 600, steps: int = 10) -> list[dict]:
        """Multi-point forecast: `steps` evenly-spaced predictions."""
        points = self._fetch(table, col, window_seconds)
        if len(points) < 2:
            return []

        slope, intercept, r2, x_center = self._fit(points)
        now = datetime.now(timezone.utc)
        step_sec = horizon_seconds / steps

        result = []
        for i in range(1, steps + 1):
            future_epoch = now.timestamp() + i * step_sec
            val = slope * (future_epoch - x_center) + intercept
            result.append(ForecastPoint(
                ts=now + timedelta(seconds=i * step_sec),
                value=val,
            ).to_dict())
        return result

    def time_to_threshold(self, table: str, col: str, limit: float,
                          window_seconds: float = 300) -> TTLResult:
        """Estimate time until value crosses `limit`."""
        points = self._fetch(table, col, window_seconds)
        if len(points) < 2:
            return TTLResult(limit, 0, 0, None, None, "stable", "数据不足")

        slope, intercept, r2, x_center = self._fit(points)
        current = points[-1][1]
        now = datetime.now(timezone.utc)

        # Direction
        if abs(slope) < self.SLOPE_EPSILON:
            return TTLResult(limit, current, slope, None, None, "stable",
                             f"趋势平稳，不会在可预见时间内触碰 {limit}")

        direction = "rising" if slope > 0 else "falling"
        needed = limit - current

        # Check if we're moving TOWARD or AWAY from the limit
        moving_toward = (direction == "rising" and needed > 0) or (direction == "falling" and needed < 0)

        if not moving_toward:
            return TTLResult(limit, current, slope, None, None, direction,
                             f"当前趋势{direction}，远离阈值{limit}，不会触碰")

        seconds = needed / slope

        if seconds <= 0:
            return TTLResult(limit, current, slope, None, None, direction,
                             f"已超限，当前值{current:.3f} vs 阈值{limit}")

        eta = now + timedelta(seconds=seconds)

        if seconds < 60:
            time_str = f"{seconds:.0f} 秒"
        elif seconds < 3600:
            time_str = f"{seconds/60:.1f} 分钟"
        elif seconds < 86400:
            time_str = f"{seconds/3600:.1f} 小时"
        else:
            time_str = f"{seconds/86400:.1f} 天"

        dir_cn = "上升" if direction == "rising" else "下降"
        msg = f"按当前趋势({slope*60:+.4f}/min)，预计 {time_str} 后{dir_cn}到 {limit}"

        return TTLResult(limit, current, slope, seconds, eta, direction, msg)
