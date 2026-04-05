"""
健康监控器 - 后台主动探测各组件健康状态，支持告警通知和持久化
"""

import asyncio
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

HEALTH_LOG_DIR = Path("data/health_logs")
HEALTH_CHECK_INTERVAL = 60       # 探测间隔 60 秒
HEALTH_ALERT_COOLDOWN = 300      # 告警冷却 5 分钟


class HealthMonitor:
    """后台健康监控 - 主动探测 + 状态变化告警 + 数据持久化"""

    def __init__(self):
        self._last_status: dict = {}          # component -> bool (ok?)
        self._cached_health: dict = {}         # 最新探测报告
        self._last_alert_time: dict = {}       # component -> timestamp
        self._app_state = None
        self._running = False
        self._task: Optional[asyncio.Task] = None

    def set_app_state(self, app_state):
        self._app_state = app_state

    def start(self):
        """启动后台监控任务"""
        self._running = True
        HEALTH_LOG_DIR.mkdir(parents=True, exist_ok=True)
        self._task = asyncio.create_task(self._loop())
        print("[HealthMonitor] 已启动，探测间隔 {} 秒".format(HEALTH_CHECK_INTERVAL))

    def stop(self):
        """停止监控"""
        self._running = False
        if self._task:
            self._task.cancel()
            print("[HealthMonitor] 已停止")

    # ─── 主循环 ───────────────────────────────────────────────────
    async def _loop(self):
        while self._running:
            try:
                await self._check_all()
            except Exception as e:
                print(f"[HealthMonitor] 检测异常: {e}")
            await asyncio.sleep(HEALTH_CHECK_INTERVAL)

    async def _check_all(self):
        """主动探测所有组件"""
        if not self._app_state:
            return

        report = {
            "timestamp": datetime.now().isoformat(),
            "components": {},
        }

        # ── MCP servers ──────────────────────────────────────────
        mcp_manager = getattr(self._app_state, "mcp_manager", None)
        if mcp_manager:
            for s in mcp_manager.server_list():
                key = f"mcp:{s['name']}"
                ok = s["status"] == "connected"
                report["components"][key] = {"ok": ok, "detail": s["status"]}
                await self._detect_change(key, ok, s["name"])

        # ── IM bots（加 try/catch，防止某个 bot 初始化失败导致整个监控崩溃）──
        im_manager = getattr(self._app_state, "im_manager", None)

        if im_manager and im_manager.telegram:
            try:
                tg_health = im_manager.telegram.get_health()
                tg_ok = tg_health.get("enabled", False)
                report["components"]["telegram"] = {"ok": tg_ok, "detail": tg_health}
                await self._detect_change("telegram", tg_ok, "Telegram")
            except Exception as e:
                print(f"[HealthMonitor] Telegram 检测失败: {e}")
                report["components"]["telegram"] = {"ok": False, "detail": str(e)}

        if im_manager and im_manager.lark:
            try:
                lark_health = im_manager.lark.get_health()
                lark_ok = lark_health.get("enabled", False)
                report["components"]["lark"] = {"ok": lark_ok, "detail": lark_health}
                await self._detect_change("lark", lark_ok, "飞书")
            except Exception as e:
                print(f"[HealthMonitor] 飞书检测失败: {e}")
                report["components"]["lark"] = {"ok": False, "detail": str(e)}

        if im_manager and im_manager.wechat:
            try:
                wx_health = im_manager.wechat.get_health()
                wx_ok = wx_health.get("enabled", False)
                report["components"]["wechat"] = {"ok": wx_ok, "detail": wx_health}
                await self._detect_change("wechat", wx_ok, "微信")
            except Exception as e:
                print(f"[HealthMonitor] 微信检测失败: {e}")
                report["components"]["wechat"] = {"ok": False, "detail": str(e)}

        # ── Scheduler ────────────────────────────────────────────
        scheduler = getattr(self._app_state, "scheduler", None)
        if scheduler:
            tc = len(scheduler._tasks)
            report["components"]["scheduler"] = {"ok": True, "task_count": tc}

        self._cached_health = report

        # 持久化
        self._persist(report)

    # ─── 状态变化检测 ────────────────────────────────────────────
    async def _detect_change(self, component: str, current_ok: bool, display_name: str):
        prev_ok = self._last_status.get(component)
        self._last_status[component] = current_ok

        if prev_ok is not None and prev_ok != current_ok:
            now = time.time()
            last_alert = self._last_alert_time.get(component, 0)
            if now - last_alert >= HEALTH_ALERT_COOLDOWN:
                await self._send_alert(display_name, prev_ok, current_ok)
                self._last_alert_time[component] = now

    # ─── 告警通知 ────────────────────────────────────────────────
    async def _send_alert(self, component: str, prev_ok: bool, current_ok: bool):
        prev_text = "正常" if prev_ok else "异常"
        curr_text = "正常" if current_ok else "异常"
        emoji = "✅" if current_ok else "❌"

        html_msg = (
            f"⚠️ <b>健康告警: {component}</b>\n"
            f"状态变化: {prev_text} → {curr_text}\n"
            f"{emoji} {'已恢复' if current_ok else '需要关注'}\n"
            f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        )

        plain_msg = (
            f"[健康告警] {component}: {prev_text} -> {curr_text} "
            f"({'已恢复' if current_ok else '需要关注'}) "
            f"@ {datetime.now().strftime('%H:%M:%S')}"
        )

        im_manager = getattr(self._app_state, "im_manager", None)
        sent = False

        # 直接通过 Telegram Bot 发送给所有活跃会话
        if im_manager and im_manager.telegram and im_manager.telegram.enabled:
            try:
                await im_manager.telegram.send_alert(html_msg)
                sent = True
            except Exception as e:
                print(f"[HealthMonitor] Telegram 告警失败: {e}")

        # 直接通过飞书 Bot 发送给所有活跃会话
        if im_manager and im_manager.lark and im_manager.lark.enabled:
            try:
                await im_manager.lark.send_alert(plain_msg)
                sent = True
            except Exception as e:
                print(f"[HealthMonitor] 飞书告警失败: {e}")

        # 通过微信机器人发送告警到主监听窗口
        if im_manager and im_manager.wechat and im_manager.wechat.enabled:
            try:
                await im_manager.wechat.send_alert(plain_msg)
                sent = True
            except Exception as e:
                print(f"[HealthMonitor] 微信告警失败: {e}")

        # 告警日志（无论 IM 是否发送成功）
        alert_log = HEALTH_LOG_DIR / "alerts.log"
        with open(alert_log, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().isoformat()}] {plain_msg}\n")

        print(f"[HealthMonitor] {'已通知' if sent else '仅记录'}: {emoji} {component} {prev_text} -> {curr_text}")

    # ─── 持久化 ──────────────────────────────────────────────────
    def _persist(self, report: dict):
        try:
            date_str = datetime.now().strftime("%Y-%m-%d")
            log_file = HEALTH_LOG_DIR / f"health_{date_str}.jsonl"
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(report, ensure_ascii=False) + "\n")
        except Exception as e:
            print(f"[HealthMonitor] 持久化失败: {e}")

    # ─── 对外接口 ────────────────────────────────────────────────
    def get_cached(self) -> dict:
        """获取缓存的最新探测数据"""
        return self._cached_health

    def get_status_changes(self) -> dict:
        """获取所有组件的最新状态 (供 /health 使用)"""
        return dict(self._last_status)


# 全局单例
health_monitor = HealthMonitor()
