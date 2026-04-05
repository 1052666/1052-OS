"""
IM 集成管理器 - 统一管理 Telegram、飞书、微信等机器人
"""

import asyncio
from typing import Optional, Callable, AsyncGenerator
from dataclasses import dataclass

from core.config import load_config
from .telegram_bot import TelegramBot
from .lark_bot import LarkBot
from .wechat_bot import WeChatBot
from .evolution_v2 import evolution_manager_v2 as evolution_manager


@dataclass
class IMChatRequest:
    """IM 聊天请求"""
    platform: str  # telegram / lark / wechat
    user_id: str
    message: str
    messages: list  # 历史消息


class IMManager:
    """IM 管理器"""

    def __init__(self):
        self.telegram: Optional[TelegramBot] = None
        self.lark: Optional[LarkBot] = None
        self.wechat: Optional[WeChatBot] = None
        self._chat_handler: Optional[Callable] = None

    def setup_chat_handler(self, handler: Callable):
        """设置聊天处理器"""
        self._chat_handler = handler
        evolution_manager.set_chat_handler(handler)

    async def load_from_config(self):
        """从配置加载并启动机器人"""
        cfg = load_config()
        im_cfg = cfg.get("im", {})

        # Telegram
        tg_cfg = im_cfg.get("telegram", {})
        if tg_cfg.get("enabled") and tg_cfg.get("token"):
            self.telegram = TelegramBot(
                token=tg_cfg["token"],
                chat_handler=self._create_handler("telegram")
            )
            await self.telegram.start()

        # 飞书
        lark_cfg = im_cfg.get("lark", {})
        if lark_cfg.get("enabled") and lark_cfg.get("app_id"):
            self.lark = LarkBot(
                app_id=lark_cfg["app_id"],
                app_secret=lark_cfg["app_secret"],
                encrypt_key=lark_cfg.get("encrypt_key"),
                verification_token=lark_cfg.get("verification_token"),
                chat_handler=self._create_handler("lark")
            )
            await self.lark.start()

        # 微信
        wx_cfg = im_cfg.get("wechat", {})
        if wx_cfg.get("enabled"):
            self.wechat = WeChatBot(
                primary_chat=wx_cfg.get("primary_chat", ""),
                mention_pattern=wx_cfg.get("mention_pattern", ""),
                bot_name=wx_cfg.get("bot_name", ""),
                chat_handler=self._create_handler("wechat"),
            )
            await self.wechat.start()

    async def reload(self):
        """重新加载配置"""
        await self.cleanup()
        await self.load_from_config()

    async def cleanup(self):
        """清理资源"""
        if self.telegram:
            await self.telegram.stop()
            self.telegram = None
        if self.lark:
            await self.lark.stop()
            self.lark = None
        if self.wechat:
            await self.wechat.stop()
            self.wechat = None

    def _create_handler(self, platform: str):
        """创建平台特定的处理器"""
        async def handler(messages: list, cancel_event=None) -> AsyncGenerator[dict, None]:
            if not self._chat_handler:
                yield {"type": "error", "content": "聊天处理器未配置"}
                return

            async for chunk in self._chat_handler(messages, cancel_event=cancel_event):
                yield chunk

        return handler

    def get_status(self) -> dict:
        """获取状态"""
        return {
            "telegram": {
                "enabled": self.telegram.enabled if self.telegram else False,
                "name": "Telegram"
            },
            "lark": {
                "enabled": self.lark.enabled if self.lark else False,
                "name": "飞书"
            },
            "wechat": {
                "enabled": self.wechat.enabled if self.wechat else False,
                "primary_chat": self.wechat.primary_chat if self.wechat else "",
                "monitored_groups": list(self.wechat._monitored_groups.keys()) if self.wechat else [],
                "name": "微信"
            }
        }
