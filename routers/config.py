from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from core.config import (
    SYSTEM_PROMPT_FILE, MCP_CONFIG_FILE, DATA_DIR,
    read_system_prompt, load_config, save_config,
)

router = APIRouter()


class SystemPromptUpdate(BaseModel):
    content: str


class MCPConfigUpdate(BaseModel):
    content: str


class AppConfigUpdate(BaseModel):
    api_key:          Optional[str]   = None
    base_url:         Optional[str]   = None
    model:            Optional[str]   = None
    temperature:      Optional[float] = None
    max_tokens:       Optional[int]   = None
    evolution_interval: Optional[int]  = None  # 进化模式间隔（秒）
    provider:         Optional[str]   = None  # 新增：provider 类型


# ─── System Prompt ────────────────────────────────────────────────
@router.get("/system-prompt")
async def get_system_prompt():
    return {"content": read_system_prompt()}


@router.put("/system-prompt")
async def update_system_prompt(body: SystemPromptUpdate):
    DATA_DIR.mkdir(exist_ok=True)
    SYSTEM_PROMPT_FILE.write_text(body.content, encoding="utf-8")
    return {"ok": True}


# ─── MCP Config ───────────────────────────────────────────────────
@router.get("/mcp/config")
async def get_mcp_config():
    if MCP_CONFIG_FILE.exists():
        return {"content": MCP_CONFIG_FILE.read_text(encoding="utf-8")}
    return {"content": '{"mcpServers": {}}'}


@router.put("/mcp/config")
async def update_mcp_config(body: MCPConfigUpdate):
    DATA_DIR.mkdir(exist_ok=True)
    MCP_CONFIG_FILE.write_text(body.content, encoding="utf-8")
    return {"ok": True}


# ─── App Config (API Key 等敏感配置，存服务端) ──────────────────────

@router.get("/config")
async def get_app_config():
    cfg = load_config()
    api_key = cfg.get("api_key", "")
    # 脱敏：只返回首尾几位，不返回完整 key
    if len(api_key) > 10:
        hint = api_key[:5] + "..." + api_key[-4:]
    elif api_key:
        hint = "***"
    else:
        hint = ""

    # 获取 provider 配置 schema
    from core.providers import get_provider_config_schema
    current_provider = cfg.get("provider", "openai_compatible")
    provider_schema = get_provider_config_schema(current_provider)

    return {
        "provider": current_provider,
        "provider_schema": provider_schema,
        "api_key_set":  bool(api_key),
        "api_key_hint": hint,
        "base_url":     cfg.get("base_url",    "https://api.openai.com/v1"),
        "model":        cfg.get("model",       "gpt-4o-mini"),
        "temperature":  cfg.get("temperature", 0.7),
        "max_tokens":   cfg.get("max_tokens",  32768),
        "evolution_interval": cfg.get("evolution_interval", 1800),  # 默认30分钟
    }


@router.get("/config/providers")
async def get_providers():
    """获取所有支持的 provider 列表及其配置 schema"""
    from core.providers import get_provider_config_schema

    return {
        "providers": [
            {"id": "openai_compatible", "name": "OpenAI Compatible", "schema": get_provider_config_schema("openai_compatible")},
            {"id": "anthropic", "name": "Anthropic (Claude)", "schema": get_provider_config_schema("anthropic")},
        ],
    }


@router.put("/config")
async def update_app_config(body: AppConfigUpdate):
    cfg = load_config()
    data = body.model_dump(exclude_none=True)
    # 若 api_key 为空字符串，不覆盖
    if "api_key" in data and not data["api_key"].strip():
        del data["api_key"]
    cfg.update(data)
    save_config(cfg)
    return {"ok": True}


# ─── Conversation ─────────────────────────────────────────────────
# GET /conversation 已移至 routers/chat.py（支持跨平台消息）

@router.delete("/conversation")
async def clear_conversation():
    from core.config import CONVERSATION_FILE
    from core.agent_runtime import get_agent_runtime
    # 清除旧的 conversation.json
    if CONVERSATION_FILE.exists():
        CONVERSATION_FILE.unlink()
    # 同时清除 AgentRuntime 中的 SessionStore 会话
    try:
        runtime = get_agent_runtime()
        runtime.clear_session(platform="web", user_id="")
    except Exception:
        pass
    return {"ok": True}
