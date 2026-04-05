"""
Agent Runtime - 统一的 Agent 运行时

这是新的核心入口，替代旧的 core/chat_engine.py 和 routers/chat.py 中的重复逻辑。

职责：
- 接收聊天请求
- 构建系统提示词（使用 prompt_builder）
- 生成上下文快照（使用 context_builder）
- 管理会话状态（使用 session_store）
- 执行工具调用（使用 tools/registry）
- 调用 provider 进行流式聊天
- 处理取消、上下文更新、错误等事件
"""

import asyncio
import json
import re
from datetime import datetime
from typing import AsyncIterable, Optional, Dict

from core.config import load_config
from core.prompt_builder import build_system_prompt
from core.context_builder import invalidate_context_cache
from core.session_store import get_session_store
from core.tools import get_tool_registry, setup_tool_registry
from core.providers.base import ProviderBase


class AgentRuntime:
    """
    统一 Agent 运行时

    替代旧的 chat_engine.py 和 routers/chat.py 中的重复逻辑
    """

    def __init__(self, app_state=None):
        self._app_state = app_state
        self._session_store = get_session_store()

        # 首次启动时自动迁移旧 conversation.json 到 SessionStore
        self._session_store.migrate_legacy_conversation()

        # 初始化 tool registry
        if app_state:
            setup_tool_registry(app_state)

    def _create_provider(
        self,
        api_key: str = None,
        base_url: str = None,
        model: str = None,
        temperature: float = None,
        max_tokens: int = None,
    ) -> ProviderBase:
        """创建 provider 实例"""
        cfg = load_config()

        provider_type = cfg.get("provider", "openai_compatible")
        api_key = api_key or cfg.get("api_key", "")
        base_url = base_url or cfg.get("base_url", "https://api.openai.com/v1")
        model = model or cfg.get("model", "gpt-4o-mini")
        temperature = temperature if temperature is not None else cfg.get("temperature", 0.7)
        max_tokens = max_tokens or cfg.get("max_tokens", 32768)

        if provider_type == "anthropic":
            from core.providers.anthropic import AnthropicProvider
            provider = AnthropicProvider(api_key=api_key, model=model)
        else:
            from core.providers.openai_compatible import OpenAICompatibleProvider
            provider = OpenAICompatibleProvider(api_key=api_key, base_url=base_url, model=model)

        # 设置工具执行器
        tool_registry = get_tool_registry()
        provider.set_tool_executor(tool_registry.execute_tool)

        return provider

    def _parse_user_info(self, messages: list) -> tuple[str, str, list]:
        """
        解析用户信息，返回 (platform, user_id, filtered_messages)

        兼容旧格式：system 消息中包含 [用户信息] 的写法
        """
        platform = "web"
        user_id = ""

        if messages and messages[0].get("role") == "system" and "[用户信息]" in messages[0].get("content", ""):
            info = messages[0]["content"]
            messages = messages[1:]
            import re as re_module
            platform_match = re_module.search(r'platform=(\w+)', info)
            user_id_match = re_module.search(r'user_id=(\d+)', info)
            if platform_match:
                platform = platform_match.group(1)
            if user_id_match:
                user_id = user_id_match.group(1)

        return platform, user_id, messages

    async def chat_stream(
        self,
        messages: list,
        platform: str = "web",
        user_id: str = "",
        temperature: float = None,
        cancel_event: Optional[asyncio.Event] = None,
    ) -> AsyncIterable[dict]:
        """
        流式聊天主入口

        这是新的统一入口，替代 core/chat_engine.py 的 chat_stream()

        Args:
            messages: 消息列表（不含 system）
            platform: 平台名称（web/telegram/lark/wechat）
            user_id: 用户 ID
            temperature: 温度参数（可选）
            cancel_event: 取消事件（可选）

        Yields:
            dict: {"type": "delta"|"done"|"error"|"tool_call"|"tool_result"|"context_update"|"cancelled", ...}
        """
        cfg = load_config()
        api_key = cfg.get("api_key", "")
        if not api_key:
            yield {"type": "error", "content": "未配置 API Key"}
            return

        # 解析用户信息（兼容旧格式）
        parsed_platform, parsed_user_id, filtered_messages = self._parse_user_info(messages)
        platform = parsed_platform or platform
        user_id = parsed_user_id or user_id

        # 设置工具执行上下文
        from core.tools import set_current_user
        set_current_user(platform, user_id)

        # 设置工具注册表的平台
        tool_registry = get_tool_registry()
        tool_registry.set_platform(platform)

        # 获取会话
        session = self._session_store.get_or_create_session(platform, user_id)

        # 获取所有平台的最近消息（让 AI 能看到跨平台上下文）
        all_platform_messages = self._session_store.get_all_recent_messages(limit=30)

        # 为跨平台消息添加平台标识
        context_messages = []
        for msg in all_platform_messages:
            meta = msg.get("_meta", {})
            msg_platform = meta.get("platform", "unknown")
            msg_content = msg.get("content", "")

            # 如果消息来自其他平台，在内容前添加平台标识
            if msg_platform != platform and msg.get("role") == "user":
                msg_content = f"[来自 {msg_platform}] {msg_content}"

            context_messages.append({
                "role": msg.get("role"),
                "content": msg_content
            })

        # 构建系统提示词
        skill_manager = self._app_state.skill_manager if self._app_state else None
        system_prompt = build_system_prompt(
            platform=platform,
            user_id=user_id,
            skill_manager=skill_manager,
        )

        # 添加跨平台上下文说明
        system_prompt += "\n\n## 多平台消息\n你可以看到来自不同平台（Web、Telegram、飞书、微信）的所有消息。带有 [来自 平台名] 标识的消息来自其他平台。"

        # 构建完整的消息列表：系统提示词 + 历史消息 + 当前消息
        full_messages = [{"role": "system", "content": system_prompt}] + context_messages + filtered_messages

        # 获取工具列表
        all_tools = tool_registry.get_all_tools()

        # 温度参数
        cfg_temp = cfg.get("temperature", 0.7)
        if temperature is not None:
            temperature = temperature
        else:
            temperature = cfg_temp
        temperature = max(temperature, 0.3)

        max_tokens = cfg.get("max_tokens", 32768)

        # 创建 provider（每次调用都创建，确保使用最新配置）
        provider = self._create_provider()

        # 使用 provider 进行流式聊天
        try:
            total_assistant_text = ""

            async for chunk in provider.stream_chat(
                messages=full_messages,
                tools=all_tools,
                temperature=temperature,
                max_tokens=max_tokens,
                cancel_event=cancel_event,
            ):
                chunk_type = chunk.get("type")

                if chunk_type == "delta":
                    total_assistant_text += chunk.get("content", "")
                    yield chunk

                elif chunk_type == "tool_call":
                    # Provider 发来的工具调用通知，直接转发
                    # 可以在这里添加工具来源信息
                    tool_name = chunk.get("name")
                    tool_id = chunk.get("id")
                    args = chunk.get("args", {})

                    # 获取工具来源信息
                    mcp_resolved = tool_registry.resolve_tool(tool_name)
                    is_skill = tool_name == "invoke_skill"

                    if is_skill:
                        source = "Skill"
                    elif mcp_resolved and mcp_resolved[0]:
                        source = f"MCP:{mcp_resolved[0]}"
                    else:
                        source = "内置"

                    yield {"type": "tool_call", "id": tool_id, "name": tool_name, "args": args, "source": source}

                elif chunk_type == "tool_result":
                    # 工具结果，直接转发
                    yield chunk

                elif chunk_type == "context_update":
                    # 上下文更新，直接转发
                    yield chunk

                elif chunk_type == "cancelled":
                    # 保存当前会话状态
                    for msg in filtered_messages:
                        if msg.get("role") == "user":
                            session.add_message("user", msg.get("content", ""))
                    if total_assistant_text:
                        session.add_message("assistant", total_assistant_text)
                    self._session_store.save_session(session)
                    yield chunk
                    return

                elif chunk_type == "done":
                    # 保存会话
                    for msg in filtered_messages:
                        if msg.get("role") == "user":
                            session.add_message("user", msg.get("content", ""))
                    if total_assistant_text:
                        session.add_message("assistant", total_assistant_text)
                    self._session_store.save_session(session)
                    yield chunk
                    return

                elif chunk_type == "error":
                    yield chunk
                    return

        except Exception as e:
            yield {"type": "error", "content": provider.format_api_error(e)}

    async def chat_once(
        self,
        prompt: str,
        platform: str = "web",
        user_id: str = "",
        temperature: float = None,
    ) -> dict:
        """
        非流式单轮聊天（供 Scheduler 使用）

        Returns:
            dict: {"content": str, "stop_reason": str, "usage": dict}
        """
        cfg = load_config()
        api_key = cfg.get("api_key", "")
        if not api_key:
            return {"content": "[执行出错] 未配置 API Key", "stop_reason": "error"}

        # 设置工具执行上下文
        from core.tools import set_current_user
        set_current_user(platform, user_id)

        # 设置工具注册表的平台
        tool_registry = get_tool_registry()
        tool_registry.set_platform(platform)

        # 获取会话
        session = self._session_store.get_or_create_session(platform, user_id)

        # 构建系统提示词
        skill_manager = self._app_state.skill_manager if self._app_state else None
        system_prompt = build_system_prompt(
            platform=platform,
            user_id=user_id,
            skill_manager=skill_manager,
        )

        # 构建消息列表
        conversation_messages = session.get_conversation_messages()
        messages = [{"role": "system", "content": system_prompt}] + conversation_messages
        messages.append({"role": "user", "content": prompt})

        # 创建 provider
        provider = self._create_provider()

        # 使用 provider 进行非流式聊天
        max_tokens = cfg.get("max_tokens", 32768)
        cfg_temp = cfg.get("temperature", 0.7)
        if temperature is not None:
            temperature = temperature
        else:
            temperature = cfg_temp
        temperature = max(temperature, 0.3)

        try:
            result = await provider.chat_once(
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )

            # 保存会话
            session.add_message("user", prompt)
            session.add_message("assistant", result["content"])
            self._session_store.save_session(session)

            return result

        except Exception as e:
            return {"content": f"[执行出错] {e}", "stop_reason": "error"}

    def clear_session(self, platform: str = "web", user_id: str = "") -> bool:
        """清空会话"""
        try:
            self._session_store.clear_session(platform, user_id)
            invalidate_context_cache()
            return True
        except Exception as e:
            print(f"[AgentRuntime] 清空会话失败: {e}")
            return False

    async def compact_session(
        self,
        platform: str = "web",
        user_id: str = "",
        preserve_recent: int = 2,
    ) -> dict:
        """
        压缩会话：将长对话总结成摘要

        Returns:
            dict: {"original_count": int, "preserve_count": int, "summary": str}
        """
        session = self._session_store.get_or_create_session(platform, user_id)

        # 获取需要压缩的消息（保留最近几条）
        old_messages = session.messages[:-preserve_recent] if len(session.messages) > preserve_recent else session.messages

        if not old_messages:
            return {
                "original_count": 0,
                "preserve_count": 0,
                "summary": "没有消息可压缩",
            }

        # 构建压缩提示
        compress_prompt = self._build_compress_prompt(old_messages)

        # 使用当前 provider 生成摘要
        provider = self._create_provider()
        messages = [{"role": "system", "content": "你是一个对话历史压缩助手。"}]
        messages.append({"role": "user", "content": compress_prompt})

        try:
            result = await provider.chat_once(messages=messages, max_tokens=2000)
            summary = result.get("content", "").strip()
        except Exception as e:
            summary = f"[压缩失败] {e}"

        # 清理思考标签
        summary = re.sub(r'<result>[\s\S]*?</result>', '', summary)
        summary = re.sub(r'<thinking>[\s\S]*?</thinking>', '', summary)
        summary = summary.replace('', '').replace('', '').strip()

        # 压缩会话
        session.compact(summary, preserve_recent)
        self._session_store.save_session(session)

        invalidate_context_cache()

        return {
            "original_count": len(old_messages) + preserve_recent,
            "preserve_count": preserve_recent,
            "summary": summary,
        }

    def _build_compress_prompt(self, messages: list) -> str:
        """构建压缩提示"""
        formatted = []
        for msg in messages:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            if content:
                role_name = {"user": "用户", "assistant": "助手", "system": "系统"}.get(role, role)
                formatted.append(f"**{role_name}：**\n{content[:500]}")

        separator = "=" * 50
        return f"""请将以下对话历史压缩成简洁的摘要，保留关键信息和要点：

---
{separator.join(formatted)}
---

压缩要求：
1. 提取对话的主要话题和目标
2. 记录重要的结论和决定
3. 保留关键的用户偏好和信息
4. 使用简洁的语言，不超过 500 字

请直接输出压缩后的摘要，不需要解释。"""

    def get_context_debug(self, platform: str = "web", user_id: str = "") -> dict:
        """
        获取上下文调试信息

        Returns:
            dict: 包含 system_prompt、各 section 长度、工具列表等
        """
        from core.context_builder import get_context_builder

        context_builder = get_context_builder()
        snapshot = context_builder.build_context_snapshot(platform, user_id)

        tool_registry = get_tool_registry()
        all_tools = tool_registry.get_all_tools()

        return {
            "snapshot": snapshot.to_dict(),
            "tools": {
                "count": len(all_tools),
                "names": [t.get("function", {}).get("name") for t in all_tools],
            },
            "session": {
                "platform": platform,
                "user_id": user_id,
                "message_count": len(self._session_store.get_or_create_session(platform, user_id).messages),
            },
        }


# 全局单例
_agent_runtime: Optional[AgentRuntime] = None


def get_agent_runtime(app_state=None) -> AgentRuntime:
    """获取全局 AgentRuntime 实例"""
    global _agent_runtime
    if _agent_runtime is None:
        _agent_runtime = AgentRuntime(app_state)
    return _agent_runtime


def setup_agent_runtime(app_state):
    """从 app_state 设置 agent runtime"""
    global _agent_runtime
    _agent_runtime = AgentRuntime(app_state)
    return _agent_runtime
