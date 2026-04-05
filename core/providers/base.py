"""
Provider 抽象层 - 统一封装 OpenAI-compatible 和 Anthropic 两种供应商调用差异
"""

from abc import ABC, abstractmethod
from typing import AsyncIterable, Optional, Any


class ProviderBase(ABC):
    """Provider 抽象基类"""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider 名称：openai_compatible / anthropic"""
        pass

    @abstractmethod
    async def stream_chat(
        self,
        messages: list,
        tools: Optional[list] = None,
        temperature: float = 0.7,
        max_tokens: int = 32768,
        cancel_event=None,
    ) -> AsyncIterable[dict]:
        """
        流式聊天主循环，处理 delta / tool_call / tool_result / done / error / context_update / cancelled

        Yields:
            dict: {
                "type": "delta"|"done"|"error"|"tool_call"|"tool_result"|"context_update"|"cancelled",
                ...其他字段
            }
        """
        pass

    @abstractmethod
    async def chat_once(
        self,
        messages: list,
        tools: Optional[list] = None,
        temperature: float = 0.7,
        max_tokens: int = 32768,
    ) -> dict:
        """
        非流式单轮调用（供 Scheduler 等不需要流式输出的场景）

        Returns:
            dict: {
                "content": str,
                "stop_reason": str,
                "usage": dict,
            }
        """
        pass

    @abstractmethod
    def format_api_error(self, e: Exception) -> str:
        """把 Provider 异常转成用户友好的提示"""
        pass

    @abstractmethod
    def build_messages(
        self,
        system_prompt: str,
        conversation_messages: list,
    ) -> list:
        """
        构建发送给模型的 messages 列表

        Args:
            system_prompt: 完整的系统提示词（已包含 env/time/user 等所有 section）
            conversation_messages: 用户对话历史

        Returns:
            符合该 Provider 格式的 messages 列表
        """
        pass
