import asyncio
import json
from typing import Optional, List

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.config import load_config
from core.agent_runtime import get_agent_runtime

router = APIRouter()


def _fmt_api_error(e: Exception) -> str:
    """把 API 异常转成用户友好的提示（保持兼容）"""
    msg = str(e)
    # 内容审核被拦截
    if "sensitive" in msg.lower() or "1027" in msg:
        return "⚠️ 内容被 API 服务商过滤（内容审核拦截），请修改提示词后重试。"
    if "content_filter" in msg.lower() or "content filter" in msg.lower():
        return "⚠️ 内容被安全过滤器拦截，请修改提示词后重试。"
    # 用量限制 / 配额超限
    if "2056" in msg or "usage limit" in msg.lower() or "limit exceeded" in msg.lower():
        return "⚠️ API 用量限制已达上限（usage limit exceeded），请检查配额或稍后重试。"
    # 认证失败
    if "401" in msg or "authentication" in msg.lower() or "api_key" in msg.lower():
        return "⚠️ API Key 无效或已过期，请在设置中检查。"
    # 余额/配额不足
    if "402" in msg or "quota" in msg.lower() or "insufficient" in msg.lower() or "balance" in msg.lower():
        return "⚠️ API 余额不足或超出配额限制。"
    # 限流
    if "429" in msg or "rate limit" in msg.lower() or "rate_limit" in msg.lower():
        return "⚠️ 请求过于频繁，已触发限流，请稍后重试。"
    # 模型不存在
    if "model" in msg.lower() and ("not found" in msg.lower() or "does not exist" in msg.lower()):
        return f"⚠️ 模型不存在或无权限访问，请检查模型名称。\n详情: {msg}"
    # 超时
    if "timeout" in msg.lower() or "timed out" in msg.lower():
        return "⚠️ 请求超时，请检查网络或稍后重试。"
    # 其他原样返回
    return msg


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages:    List[Message]
    api_key:     Optional[str]   = None   # 可选，优先用服务端配置
    base_url:    Optional[str]   = None
    model:       Optional[str]   = None
    temperature: Optional[float] = None
    max_tokens:  Optional[int]   = None
    platform:    Optional[str]   = "web"     # 当前平台
    user_id:     Optional[str]   = ""        # 当前用户ID（用于定时任务发送）


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, request: Request):
    """
    流式聊天接口 - 使用新的 Agent Runtime

    这是重构后的版本，所有逻辑通过 core.agent_runtime.AgentRuntime 统一处理
    """
    runtime = get_agent_runtime()

    async def generate():
        try:
            # 将请求消息转换为 runtime 格式
            messages = [{"role": m.role, "content": m.content} for m in req.messages]

            # 调用 runtime 的流式聊天
            async for chunk in runtime.chat_stream(
                messages=messages,
                platform=req.platform or "web",
                user_id=req.user_id or "",
                temperature=req.temperature,
            ):
                # 转换为 SSE 格式
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': _fmt_api_error(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/chat/clear")
async def clear_chat(req: ChatRequest, request: Request):
    """
    清空当前会话
    """
    runtime = get_agent_runtime()
    success = runtime.clear_session(
        platform=req.platform or "web",
        user_id=req.user_id or "",
    )
    return {"ok": success}


@router.post("/chat/compact")
async def compact_chat(req: ChatRequest, request: Request):
    """
    压缩当前会话
    """
    runtime = get_agent_runtime()
    result = await runtime.compact_session(
        platform=req.platform or "web",
        user_id=req.user_id or "",
    )
    return {"ok": True, **result}


@router.get("/chat/context-debug")
async def context_debug(request: Request):
    """
    获取上下文调试信息
    """
    runtime = get_agent_runtime()
    info = runtime.get_context_debug()
    return info


@router.get("/conversation")
async def get_conversation(platform: str = "web", user_id: str = ""):
    """
    获取对话历史（支持跨平台查看）

    从 SessionStore 加载所有平台的最近消息。
    """
    from core.session_store import get_session_store

    store = get_session_store()

    # 获取所有平台的最近消息
    all_messages = store.get_all_recent_messages(limit=200)

    # 为每条消息添加平台标识显示
    formatted_messages = []
    for msg in all_messages:
        meta = msg.get("_meta", {})
        msg_platform = meta.get("platform", "unknown")
        msg_user_id = meta.get("user_id", "")

        formatted_msg = {
            "role": msg.get("role"),
            "content": msg.get("content"),
            "platform": msg_platform,
            "user_id": msg_user_id,
        }
        formatted_messages.append(formatted_msg)

    return {"messages": formatted_messages}
