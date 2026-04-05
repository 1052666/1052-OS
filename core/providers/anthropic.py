"""
Anthropic Provider 实现
"""

import asyncio
import json
from typing import AsyncIterable, Optional

from core.providers.base import ProviderBase

# 延迟导入 anthropic，使其成为可选依赖
try:
    from anthropic import AsyncAnthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False
    AsyncAnthropic = None


class AnthropicProvider(ProviderBase):
    """Anthropic Provider (Claude API)"""

    def __init__(self, api_key: str, model: str = "claude-opus-4-6"):
        if not HAS_ANTHROPIC:
            raise ImportError("anthropic 包未安装，请运行: pip install anthropic")
        self.api_key = api_key
        self.model = model
        self._client: Optional[AsyncAnthropic] = None
        self._tool_executor = None

    @property
    def name(self) -> str:
        return "anthropic"

    def set_tool_executor(self, executor):
        """设置工具执行器回调"""
        self._tool_executor = executor

    def _get_client(self) -> AsyncAnthropic:
        if self._client is None:
            self._client = AsyncAnthropic(api_key=self.api_key)
        return self._client

    def format_api_error(self, e: Exception) -> str:
        msg = str(e)
        if "401" in msg or "authentication" in msg.lower():
            return "⚠️ API Key 无效或已过期，请在设置中检查。"
        if "403" in msg or "permission" in msg.lower():
            return "⚠️ API Key 权限不足，请检查密钥权限。"
        if "429" in msg or "rate limit" in msg.lower():
            return "⚠️ 请求过于频繁，已触发限流，请稍后重试。"
        if "500" in msg or "internal error" in msg.lower():
            return "⚠️ Anthropic 服务端错误，请稍后重试。"
        if "529" in msg or "overloaded" in msg.lower():
            return "⚠️ Anthropic 服务暂时过载，请稍后重试。"
        if "timeout" in msg.lower() or "timed out" in msg.lower():
            return "⚠️ 请求超时，请检查网络或稍后重试。"
        return msg

    def _tools_to_anthropic(self, tools: Optional[list]) -> Optional[list]:
        """将 OpenAI 格式的工具定义转换为 Anthropic 格式"""
        if not tools:
            return None
        anthropic_tools = []
        for tool in tools:
            func = tool.get("function", {})
            anthropic_tools.append({
                "name": func.get("name"),
                "description": func.get("description"),
                "input_schema": func.get("parameters", {}),
            })
        return anthropic_tools

    def _messages_to_anthropic(self, messages: list) -> tuple[Optional[str], list]:
        """
        将 OpenAI 格式 messages 转换为 Anthropic 格式。
        OpenAI 格式的 system 消息被提取为独立的 system 参数。
        """
        system = None
        anthropic_messages = []
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content", "")
            if role == "system":
                system = content
            elif role in ("user", "assistant"):
                anthropic_messages.append({"role": role, "content": content})
            elif role == "tool":
                anthropic_messages.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": msg.get("tool_call_id", ""),
                        "content": content,
                    }]
                })
        return system, anthropic_messages

    def build_messages(self, system_prompt: str, conversation_messages: list) -> list:
        messages = [{"role": "system", "content": system_prompt}]
        messages += [{"role": m.get("role", "user"), "content": m.get("content", "")} for m in conversation_messages]
        return messages

    async def stream_chat(
        self,
        messages: list,
        tools: Optional[list] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        cancel_event=None,
    ) -> AsyncIterable[dict]:
        client = self._get_client()
        system, anthropic_messages = self._messages_to_anthropic(messages)

        tool_call_count = 0
        max_tool_calls = 200

        try:
            while True:
                if cancel_event and cancel_event.is_set():
                    yield {"type": "cancelled"}
                    return

                async with client.messages.stream(
                    model=self.model,
                    max_tokens=max_tokens,
                    system=system,
                    messages=anthropic_messages,
                    tools=self._tools_to_anthropic(tools) if tools else None,
                    temperature=temperature,
                ) as stream:
                    full_content = ""
                    tool_use_blocks = []

                    async for event in stream:
                        if event.type == "content_block_delta":
                            if event.delta.type == "text_delta":
                                text = event.delta.text
                                full_content += text
                                yield {"type": "delta", "content": text}

                        elif event.type == "content_block_stop":
                            block = event.content_block
                            if hasattr(block, 'type') and block.type == "tool_use":
                                tool_use_blocks.append(block)

                        elif event.type == "message_delta":
                            stop_reason = event.delta.stop_reason

                        elif event.type == "message_stop":
                            message = stream.get_message()
                            stop_reason = message.stop_reason

                            if stop_reason == "end_turn":
                                yield {"type": "done"}
                                return

                            if stop_reason == "tool_use":
                                tool_use_blocks = [b for b in message.content if b.type == "tool_use"]
                                if not tool_use_blocks:
                                    yield {"type": "done"}
                                    return

                                tool_call_count += len(tool_use_blocks)
                                if tool_call_count > max_tool_calls:
                                    yield {"type": "done"}
                                    return

                                # 添加 assistant 消息
                                anthropic_messages.append({
                                    "role": "assistant",
                                    "content": message.content,
                                })

                                # 执行所有工具
                                for block in tool_use_blocks:
                                    tool_id = block.id
                                    tool_name = block.name
                                    tool_input = block.input

                                    yield {"type": "tool_call", "id": tool_id, "name": tool_name, "args": tool_input}

                                    # 执行工具（通过回调）
                                    if self._tool_executor:
                                        try:
                                            result = await asyncio.wait_for(
                                                self._tool_executor(tool_name, tool_input),
                                                timeout=60.0
                                            )
                                        except asyncio.TimeoutError:
                                            result = f"[错误] 工具 '{tool_name}' 执行超时（60秒）"
                                        except Exception as e:
                                            result = f"[错误] 工具 '{tool_name}' 执行失败: {e}"
                                    else:
                                        result = "[错误] 未设置工具执行器"

                                    yield {"type": "tool_result", "id": tool_id, "name": tool_name, "result": result}

                                    # 添加工具结果消息
                                    anthropic_messages.append({
                                        "role": "user",
                                        "content": [{
                                            "type": "tool_result",
                                            "tool_use_id": tool_id,
                                            "content": result,
                                        }],
                                    })

                                # 发送上下文更新
                                yield {"type": "context_update", "messages": anthropic_messages}

                                break

                            else:
                                yield {"type": "done"}
                                return

                    else:
                        yield {"type": "done"}
                        return

        except Exception as e:
            yield {"type": "error", "content": self.format_api_error(e)}

    async def chat_once(
        self,
        messages: list,
        tools: Optional[list] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> dict:
        client = self._get_client()
        system, anthropic_messages = self._messages_to_anthropic(messages)

        resp = await client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=anthropic_messages,
            tools=self._tools_to_anthropic(tools) if tools else None,
            temperature=temperature,
        )

        text_content = ""
        for block in resp.content:
            if block.type == "text":
                text_content += block.text

        return {
            "content": text_content,
            "stop_reason": resp.stop_reason,
            "usage": {
                "input_tokens": resp.usage.input_tokens if resp.usage else 0,
                "output_tokens": resp.usage.output_tokens if resp.usage else 0,
            } if resp.usage else {},
        }
