"""
OpenAI-compatible Provider 实现
"""

import asyncio
import json
from typing import AsyncIterable, Optional, Callable

from openai import AsyncOpenAI

from core.providers.base import ProviderBase


class OpenAICompatibleProvider(ProviderBase):
    """OpenAI-compatible Provider"""

    def __init__(self, api_key: str, base_url: str = "https://api.openai.com/v1", model: str = "gpt-4o-mini"):
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self._client: Optional[AsyncOpenAI] = None
        self._tool_executor: Optional[Callable] = None

    @property
    def name(self) -> str:
        return "openai_compatible"

    def set_tool_executor(self, executor: Callable):
        """设置工具执行器回调"""
        self._tool_executor = executor

    def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)
        return self._client

    def format_api_error(self, e: Exception) -> str:
        msg = str(e)
        if "sensitive" in msg.lower() or "1027" in msg:
            return "⚠️ 内容被 API 服务商过滤（内容审核拦截），请修改提示词后重试。"
        if "content_filter" in msg.lower() or "content filter" in msg.lower():
            return "⚠️ 内容被安全过滤器拦截，请修改提示词后重试。"
        if "2056" in msg or "usage limit" in msg.lower() or "limit exceeded" in msg.lower():
            return "⚠️ API 用量限制已达上限（usage limit exceeded），请检查配额或稍后重试。"
        if "401" in msg or "authentication" in msg.lower() or "api_key" in msg.lower():
            return "⚠️ API Key 无效或已过期，请在设置中检查。"
        if "402" in msg or "quota" in msg.lower() or "insufficient" in msg.lower() or "balance" in msg.lower():
            return "⚠️ API 余额不足或超出配额限制。"
        if "429" in msg or "rate limit" in msg.lower() or "rate_limit" in msg.lower():
            return "⚠️ 请求过于频繁，已触发限流，请稍后重试。"
        if "model" in msg.lower() and ("not found" in msg.lower() or "does not exist" in msg.lower()):
            return f"⚠️ 模型不存在或无权限访问，请检查模型名称。\n详情: {msg}"
        if "timeout" in msg.lower() or "timed out" in msg.lower():
            return "⚠️ 请求超时，请检查网络或稍后重试。"
        return msg

    def build_messages(self, system_prompt: str, conversation_messages: list) -> list:
        messages = [{"role": "system", "content": system_prompt}]
        messages += [{"role": m.get("role", "user"), "content": m.get("content", "")} for m in conversation_messages]
        return messages

    async def stream_chat(
        self,
        messages: list,
        tools: Optional[list] = None,
        temperature: float = 0.7,
        max_tokens: int = 32768,
        cancel_event=None,
    ) -> AsyncIterable[dict]:
        """
        流式聊天 - 完整的工具循环

        由 provider 内部处理完整的工具调用循环，通过 tool_executor 回调执行工具
        """
        client = self._get_client()
        tool_call_count = 0
        max_tool_calls = 200

        try:
            while True:
                if cancel_event and cancel_event.is_set():
                    yield {"type": "cancelled"}
                    return

                stream = await client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    tools=tools,
                    tool_choice="auto",
                    stream=True,
                    temperature=max(temperature, 0.3),
                    max_tokens=max_tokens,
                )

                full_content = ""
                tool_calls: dict[int, dict] = {}
                finish_reason = None

                async for chunk in stream:
                    if not chunk.choices:
                        continue
                    choice = chunk.choices[0]
                    delta = choice.delta

                    if delta.content:
                        full_content += delta.content
                        yield {"type": "delta", "content": delta.content}

                    if delta.tool_calls:
                        for tc in delta.tool_calls:
                            idx = tc.index
                            if idx not in tool_calls:
                                tool_calls[idx] = {"id": "", "name": "", "args": ""}
                            if tc.id:
                                tool_calls[idx]["id"] = tc.id
                            if tc.function and tc.function.name:
                                tool_calls[idx]["name"] = tc.function.name
                            if tc.function and tc.function.arguments:
                                tool_calls[idx]["args"] += tc.function.arguments

                    if choice.finish_reason:
                        finish_reason = choice.finish_reason

                if finish_reason == "length" and tool_calls:
                    yield {"type": "error", "content": "[输出被截断] 工具调用参数过长，请在设置中增大 Max Tokens（建议 8192 以上），然后重试。"}
                    break

                if finish_reason != "tool_calls" or not tool_calls:
                    yield {"type": "done"}
                    break

                tool_call_count += len(tool_calls)
                if tool_call_count > max_tool_calls:
                    yield {"type": "done"}
                    break

                # 添加 assistant 消息（包含 tool_calls）
                messages.append({
                    "role": "assistant",
                    "content": full_content or None,
                    "tool_calls": [
                        {"id": tc["id"], "type": "function",
                         "function": {"name": tc["name"], "arguments": tc["args"]}}
                        for tc in tool_calls.values()
                    ],
                })

                # 执行所有工具调用
                for tc in tool_calls.values():
                    try:
                        args = json.loads(tc["args"])
                    except Exception:
                        args = {}

                    tool_name = tc["name"]
                    tool_id = tc["id"]

                    # 发送工具调用通知
                    yield {"type": "tool_call", "id": tool_id, "name": tool_name, "args": args}

                    # 执行工具（通过回调）
                    if self._tool_executor:
                        try:
                            result = await asyncio.wait_for(
                                self._tool_executor(tool_name, args),
                                timeout=60.0
                            )
                        except asyncio.TimeoutError:
                            result = f"[错误] 工具 '{tool_name}' 执行超时（60秒）"
                        except Exception as e:
                            result = f"[错误] 工具 '{tool_name}' 执行失败: {e}"
                    else:
                        result = "[错误] 未设置工具执行器"

                    # 发送工具结果
                    yield {"type": "tool_result", "id": tool_id, "name": tool_name, "result": result}

                    # 添加工具结果消息
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_id,
                        "content": result,
                    })

                # 发送上下文更新
                yield {"type": "context_update", "messages": [dict(m) for m in messages]}

                if cancel_event and cancel_event.is_set():
                    yield {"type": "cancelled"}
                    return

        except Exception as e:
            yield {"type": "error", "content": self.format_api_error(e)}

    async def chat_once(
        self,
        messages: list,
        tools: Optional[list] = None,
        temperature: float = 0.7,
        max_tokens: int = 32768,
    ) -> dict:
        client = self._get_client()
        resp = await client.chat.completions.create(
            model=self.model,
            messages=messages,
            tools=tools,
            temperature=max(temperature, 0.3),
            max_tokens=max_tokens,
        )
        return {
            "content": resp.choices[0].message.content or "",
            "stop_reason": resp.choices[0].finish_reason,
            "usage": {
                "input_tokens": resp.usage.prompt_tokens if resp.usage else 0,
                "output_tokens": resp.usage.completion_tokens if resp.usage else 0,
            } if resp.usage else {},
        }
