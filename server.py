import asyncio
import json
import time
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from core.config import MCP_CONFIG_FILE
from core.skill_manager import SkillManager
from core.scheduler import TaskScheduler
from core.tools import set_scheduler, set_im_manager
from core.agent_runtime import setup_agent_runtime, get_agent_runtime
from core.health_monitor import health_monitor
from core.logger import setup_logging, get_logger
from core.exceptions import (
    AppException, app_exception_handler,
    validation_exception_handler, general_exception_handler
)
from mcp_client.manager import MCPManager
from im_integration.manager import IMManager
import routers.chat as chat_router
import routers.config as config_router
import routers.skills as skills_router
import routers.scheduler as scheduler_router
import routers.im as im_router
import mcp_client.router as mcp_router

# 初始化日志系统
setup_logging()
logger = get_logger(__name__)

SKILLS_DIR  = Path(__file__).parent / "skills"
DATA_DIR    = Path(__file__).parent / "data"
OUTPUT_DIR  = DATA_DIR / "1111"

# ─── 全局异常捕获（防止后台任务崩溃不留日志）─────────────────────────
def _exception_handler(loop, context):
    exc = context.get("exception")
    msg = context.get("message", "")
    logger.critical(f"未捕获异常退出: {msg}")
    if exc:
        logger.exception("异常详情:", exc_info=exc)
    else:
        logger.critical(f"上下文: {context}")

asyncio.get_event_loop().set_exception_handler(_exception_handler)

# 全局启动时间
_start_time = time.time()


# ─── Lifespan ─────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # MCP
    app.state.mcp_manager = MCPManager()
    await app.state.mcp_manager.load_from_config(MCP_CONFIG_FILE)

    # Skills
    app.state.skill_manager = SkillManager(SKILLS_DIR)
    app.state.skill_manager.load_all()
    watcher_task = asyncio.create_task(app.state.skill_manager.watch())

    # Scheduler
    app.state.scheduler = TaskScheduler(DATA_DIR)
    app.state.scheduler.load()
    app.state.scheduler.set_app_state(app.state)  # 设置 app_state 用于发送消息
    set_scheduler(app.state.scheduler)  # 让 tools.py 可以访问
    scheduler_loop = asyncio.create_task(app.state.scheduler.run_loop())

    # IM 集成 (Telegram / 飞书 / 微信)
    # 注意: AgentRuntime 必须在 IM 之前初始化，因为 IM handler 依赖它
    setup_agent_runtime(app.state)

    app.state.im_manager = IMManager()
    app.state.im_manager.setup_chat_handler(
        lambda msgs, cancel_event=None: _im_chat_stream(msgs, cancel_event=cancel_event)
    )
    await app.state.im_manager.load_from_config()
    set_im_manager(app.state.im_manager)  # 让 tools.py 可以访问微信机器人

    # 进化模式管理器（使用 v2）
    from im_integration.evolution_v2 import evolution_manager_v2
    evolution_manager_v2.set_app_state(app.state)

    # 健康监控
    health_monitor.set_app_state(app.state)
    health_monitor.start()

    yield

    health_monitor.stop()
    watcher_task.cancel()
    scheduler_loop.cancel()
    await app.state.mcp_manager.cleanup()
    await app.state.im_manager.cleanup()


# ─── Chat handler for IM (using AgentRuntime) ────────────────────
async def _im_chat_stream(messages: list, cancel_event=None):
    """为 IM 提供的流式聊天处理器（委托给 AgentRuntime）"""
    runtime = get_agent_runtime()
    async for chunk in runtime.chat_stream(messages=messages, cancel_event=cancel_event):
        yield chunk


# ─── App ──────────────────────────────────────────────────────────
app = FastAPI(lifespan=lifespan)

# 注册异常处理器
from fastapi.exceptions import RequestValidationError
app.add_exception_handler(AppException, app_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(Exception, general_exception_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ─────────────────────────────────────────────────────
app.include_router(chat_router.router)
app.include_router(config_router.router)
app.include_router(mcp_router.router)
app.include_router(skills_router.router)
app.include_router(scheduler_router.router)
app.include_router(im_router.router)

# ─── Static files ─────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory="static"), name="static")

# ─── Output files (AI 生成文件) ───────────────────────────────────
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=str(OUTPUT_DIR)), name="output_files")


@app.get("/")
async def root():
    return FileResponse("static/index.html")


# ─── Health check / 心跳检测 ────────────────────────────────────────
@app.get("/health")
async def health_check(request: Request):
    from core.config import load_config

    cfg = load_config()
    uptime = int(time.time() - _start_time)

    # IM 状态
    im_manager = request.app.state.im_manager
    telegram = im_manager.telegram
    lark = im_manager.lark
    wechat = im_manager.wechat

    tg_health = telegram.get_health() if telegram else {"enabled": False}
    lark_health = lark.get_health() if lark else {"enabled": False}
    wx_health = wechat.get_health() if wechat else {"enabled": False}

    # MCP 状态
    mcp_manager = request.app.state.mcp_manager
    mcp_servers = mcp_manager.server_list()
    mcp_ok = all(s["status"] == "connected" for s in mcp_servers) if mcp_servers else True

    # 定时任务
    scheduler = request.app.state.scheduler
    task_count = len(scheduler._tasks)

    # API Key
    api_key_set = bool(cfg.get("api_key"))

    # Provider 信息
    from core.providers import get_provider_config_schema
    current_provider = cfg.get("provider", "openai_compatible")
    provider_schema = get_provider_config_schema(current_provider)

    # 进化模式
    from im_integration.evolution_v2 import evolution_manager_v2
    evolution_active = evolution_manager_v2.active

    # 后台监控缓存数据
    cached = health_monitor.get_cached()
    last_check = cached.get("timestamp") if cached else None
    alerts = _read_recent_alerts(5)

    return {
        "ok": True,
        "uptime": uptime,
        "api_key": api_key_set,
        "provider": {
            "type": current_provider,
            "schema": provider_schema,
        },
        "telegram": tg_health,
        "lark": lark_health,
        "wechat": wx_health,
        "mcp": {
            "ok": mcp_ok,
            "servers": [{"name": s["name"], "status": s["status"]} for s in mcp_servers],
        },
        "scheduler": {
            "running": True,
            "task_count": task_count,
        },
        "evolution": {
            "active": evolution_active,
        },
        "monitor": {
            "last_check": last_check,
            "interval": 60,
        },
        "alerts": alerts,
    }


def _read_recent_alerts(count: int = 5) -> list:
    """读取最近的告警记录"""
    alerts = []
    alert_file = Path("data/health_logs/alerts.log")
    if not alert_file.exists():
        return alerts
    try:
        lines = alert_file.read_text(encoding="utf-8").strip().split("\n")
        for line in lines[-count:]:
            if line.strip():
                alerts.append(line.strip())
    except Exception:
        pass
    return alerts


# ─── Entry point ──────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    import os

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))

    logger.info("启动 AI 聊天服务器...")
    logger.info(f"访问 http://localhost:{port} 打开聊天页面")
    uvicorn.run(app, host=host, port=port)
