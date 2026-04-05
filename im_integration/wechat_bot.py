"""
微信机器人 - 基于 wechat_msg (pywechat/pyweixin) 实现消息监听与回复

支持:
  - 主监听窗口: 监听指定聊天, 群聊中 @机器人 才响应
  - 群聊监听管理: 监听/停止监听指定群聊
  - 消息发送: 给指定聊天发送消息/文件
  - 与 chat_handler 集成: 流式 AI 回复
"""

import asyncio
import os
import re
import sys
import time as _time
from pathlib import Path
from typing import Callable, Optional

from core.config import DATA_DIR

# 将 wx 目录加入 sys.path 以便导入 wechat_msg
_WX_DIR = str(Path(__file__).resolve().parent.parent / "wx")
if _WX_DIR not in sys.path:
    sys.path.insert(0, _WX_DIR)

# 延迟导入
_wechat_msg = None


_engine_module = None
_engine_version = None


def _get_wechat_msg():
    """延迟加载 wechat_msg 模块"""
    global _wechat_msg
    if _wechat_msg is None:
        try:
            import wechat_msg
            _wechat_msg = wechat_msg
        except ImportError as e:
            print(f"[WeChat] wechat_msg 导入失败: {e}")
            raise
    return _wechat_msg


def _get_engine():
    """获取引擎模块和版本（缓存）"""
    global _engine_module, _engine_version
    if _engine_module is None:
        wx = _get_wechat_msg()
        _engine_module, _engine_version = wx.get_engine()
    return _engine_module, _engine_version


class WeChatBot:
    """微信机器人，基于 wechat_msg 实现消息监听和回复"""

    # 打断管理
    _cancel_events: dict[str, asyncio.Event] = {}

    def __init__(
        self,
        primary_chat: str = "",
        mention_pattern: str = "",
        bot_name: str = "",
        chat_handler: Optional[Callable] = None,
    ):
        self.primary_chat = primary_chat
        self.bot_name = bot_name
        self._raw_mention_pattern = mention_pattern
        self.mention_pattern = mention_pattern or ""
        self.chat_handler = chat_handler
        self._enabled = False
        self._task: Optional[asyncio.Task] = None
        self._monitored_groups: dict[str, asyncio.Task] = {}
        self._active_chats: dict[str, float] = {}
        self._cancel_event = asyncio.Event()

    @property
    def enabled(self) -> bool:
        return self._enabled

    def get_health(self) -> dict:
        """获取健康状态"""
        return {
            "enabled": self._enabled,
            "primary_chat": self.primary_chat,
            "bot_name": self.bot_name,
            "monitored_groups": list(self._monitored_groups.keys()),
            "mention_pattern": self.mention_pattern,
        }

    async def send_alert(self, text: str):
        """发送告警到主监听窗口"""
        if self.primary_chat:
            await self.send_to_chat(self.primary_chat, text)

    # ─── 生命周期 ───

    async def start(self):
        """启动微信机器人"""
        try:
            wx = _get_wechat_msg()
            version = await asyncio.to_thread(wx.detect_wechat_version)
            print(f"[WeChat] 检测到微信版本: {version}")

            # 配置机器人名称（不再自动检测）
            self._setup_bot_name()

            self._enabled = True
            self._cancel_event = asyncio.Event()

            if self.primary_chat:
                self._task = asyncio.create_task(self._monitor_loop())
                print(f"[WeChat] 机器人已启动 (主窗口: {self.primary_chat})")
            else:
                print("[WeChat] 机器人已启动 (无主窗口，仅命令模式)")

        except Exception as e:
            print(f"[WeChat] 启动失败: {e}")
            self._enabled = False

    def _setup_bot_name(self):
        """配置机器人名称（不自动检测，避免打开微信窗口卡住）"""
        if self.bot_name:
            print(f"[WeChat] 使用配置的机器人名称: {self.bot_name}")
        else:
            print(f"[WeChat] ⚠️ 未配置 bot_name，请在 config.json 的 im.wechat.bot_name 中设置")
            print(f"[WeChat] 否则群聊中的 @消息 将无法被识别")

        # 构建 mention_pattern
        patterns = []
        if self.bot_name:
            patterns.append(re.escape(f"@{self.bot_name}"))
        if self._raw_mention_pattern:
            patterns.append(self._raw_mention_pattern)

        if patterns:
            self.mention_pattern = "|".join(patterns)
        else:
            self.mention_pattern = r"@\S+"

        print(f"[WeChat] @识别模式: {self.mention_pattern}")

    async def stop(self):
        """停止微信机器人"""
        self._enabled = False
        self._cancel_event.set()

        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

        for name, task in list(self._monitored_groups.items()):
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._monitored_groups.clear()

        print("[WeChat] 机器人已停止")

    # ─── 主监听循环 ───

    async def _monitor_loop(self):
        """后台持续监听主窗口消息"""
        wx = _get_wechat_msg()

        while self._enabled and not self._cancel_event.is_set():
            try:
                messages = await asyncio.to_thread(
                    wx.listen_on_chat,
                    friend=self.primary_chat,
                    duration="10min",
                    close_wechat=False,
                )

                if messages and self._enabled:
                    for msg in messages:
                        if isinstance(msg, str) and msg.strip():
                            await self._handle_message(
                                self.primary_chat, msg.strip(), is_group=False
                            )

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[WeChat] 监听错误: {e}")
                await asyncio.sleep(5)

    # ─── 群聊监听 ───

    async def monitor_group(self, group_name: str) -> str:
        """开始监听指定群聊"""
        if group_name in self._monitored_groups:
            return f"⚠️ {group_name} 已在监听中"

        task = asyncio.create_task(self._group_monitor_loop(group_name))
        self._monitored_groups[group_name] = task
        print(f"[WeChat] 开始监听群聊: {group_name}")
        return f"✅ 开始监听群聊: {group_name}"

    async def unmonitor_group(self, group_name: str) -> str:
        """停止监听指定群聊"""
        task = self._monitored_groups.pop(group_name, None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            print(f"[WeChat] 停止监听群聊: {group_name}")
            return f"✅ 停止监听群聊: {group_name}"
        return f"⚠️ {group_name} 未在监听中"

    async def _group_monitor_loop(self, group_name: str):
        """群聊监听循环"""
        wx = _get_wechat_msg()

        while self._enabled and not self._cancel_event.is_set():
            try:
                messages = await asyncio.to_thread(
                    wx.listen_on_chat,
                    friend=group_name,
                    duration="10min",
                    close_wechat=False,
                )

                if messages and self._enabled:
                    for msg in messages:
                        if isinstance(msg, str) and msg.strip():
                            await self._handle_message(
                                group_name, msg.strip(), is_group=True
                            )

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[WeChat] 群聊监听错误 ({group_name}): {e}")
                await asyncio.sleep(5)

    # ─── 消息处理 ───

    async def _handle_message(self, chat_name: str, content: str, is_group: bool):
        """处理收到的消息"""
        if not self.chat_handler:
            return

        print(f"[WeChat] 收到消息: chat={chat_name}, group={is_group}, content={content[:100]}")

        # 群聊中检测 @
        if is_group and not self._is_mentioned(content):
            return

        # 清理 @ 标记
        clean_content = self._remove_mention(content)

        # ── 命令处理 ──
        cmd = clean_content.strip()
        if cmd in ("/new", "/新建"):
            from core.agent_runtime import get_agent_runtime
            get_agent_runtime().clear_session(platform="wechat", user_id=chat_name)
            await self.send_to_chat(chat_name, "✅ 对话已清空")
            return
        if cmd in ("/compress", "/压缩"):
            from core.agent_runtime import get_agent_runtime
            runtime = get_agent_runtime()
            result = await runtime.compact_session(platform="wechat", user_id=chat_name)
            await self.send_to_chat(chat_name, f"✅ 压缩完成: {result.get('summary', '完成')}")
            return
        if cmd in ("/evolve", "/进化", "/1052进化"):
            from im_integration.evolution_v2 import evolution_manager_v2 as evo
            evo.set_user("wechat", chat_name)
            result = await evo.trigger()
            await self.send_to_chat(chat_name, result)
            return
        if cmd in ("/stop", "/停止"):
            from im_integration.evolution_v2 import evolution_manager_v2 as evo
            result = await evo.stop()
            await self.send_to_chat(chat_name, result)
            return
        if cmd in ("/help", "/帮助", "/1052", "/1052菜单"):
            help_text = (
                "📋 1052 可用命令\n\n"
                "/new 或 /新建 — 新建对话\n"
                "/compress 或 /压缩 — 压缩对话历史\n"
                "/evolve 或 /进化 — 开启进化模式\n"
                "/stop 或 /停止 — 停止进化模式\n"
                "/help 或 /帮助 — 查看帮助\n\n"
                "直接发送消息与我对话"
            )
            await self.send_to_chat(chat_name, help_text)
            return

        # 记录活跃会话
        self._active_chats[chat_name] = _time.time()

        # ── 打断旧的处理 ──
        old_event = self._cancel_events.get(chat_name)
        if old_event:
            old_event.set()

        # ── 创建本处理的取消事件 ──
        cancel_event = asyncio.Event()
        self._cancel_events[chat_name] = cancel_event

        # 只传递新消息，AgentRuntime 从 SessionStore 加载历史
        messages = [
            {"role": "system", "content": f"[用户信息] platform=wechat, chat={chat_name}"},
            {"role": "user", "content": clean_content},
        ]

        # ── 流式处理 ──
        full_response = ""

        try:
            async for chunk in self.chat_handler(messages, cancel_event=cancel_event):
                chunk_type = chunk.get("type")

                if cancel_event.is_set():
                    # AgentRuntime 已自动保存部分状态
                    return

                if chunk_type == "cancelled":
                    return

                if chunk_type == "delta":
                    full_response += chunk.get("content", "")

                elif chunk_type == "tool_result":
                    result_content = str(chunk.get("result", ""))
                    # 检测文件标记
                    wx_file_match = re.search(r'\[WX_FILE:([^\]]+)\]', result_content)
                    if wx_file_match:
                        await self._send_file(chat_name, wx_file_match.group(1))

                elif chunk_type == "file":
                    await self._send_file(chat_name, chunk.get("url", ""))

                elif chunk_type == "error":
                    await self.send_to_chat(chat_name, f"错误: {chunk.get('content', '')}")
                    return

            # ── 最终回复 ──
            if full_response:
                clean_response = self._remove_thinking_tags(full_response)
                if clean_response:
                    await self.send_to_chat(chat_name, clean_response)

            # AgentRuntime 已自动保存会话，无需手动保存

        except Exception as e:
            print(f"[WeChat] 处理消息异常: {e}")
            import traceback
            traceback.print_exc()

    # ─── 发送消息 ───

    async def send_to_chat(self, target: str, message: str):
        """发送文本消息到指定聊天"""
        if not message:
            return

        max_len = 2000
        chunks = []
        while message:
            chunks.append(message[:max_len])
            message = message[max_len:]

        try:
            wx = _get_wechat_msg()
            for chunk in chunks:
                await asyncio.to_thread(
                    wx.send_message,
                    friend=target,
                    messages=[chunk],
                    close_wechat=False,
                )
                print(f"[WeChat] 消息已发送: target={target}, len={len(chunk)}")
        except Exception as e:
            print(f"[WeChat] 发送消息失败: {e}")

    async def _send_file(self, target: str, file_path: str):
        """发送文件到指定聊天"""
        if not file_path:
            return

        if file_path.startswith("/files/"):
            local_path = str(DATA_DIR / "1111" / file_path[8:])
        elif file_path.startswith("data/1111/"):
            local_path = str(DATA_DIR / "1111" / file_path[11:])
        elif not os.path.isabs(file_path):
            local_path = str(DATA_DIR / "1111" / file_path)
        else:
            local_path = file_path

        local_path = os.path.normpath(local_path)

        if not os.path.exists(local_path):
            print(f"[WeChat] 文件不存在: {local_path}")
            return

        try:
            wx = _get_wechat_msg()
            await asyncio.to_thread(
                wx.send_file,
                friend=target,
                files=[local_path],
                close_wechat=False,
            )
            print(f"[WeChat] 文件已发送: target={target}, file={local_path}")
        except Exception as e:
            print(f"[WeChat] 发送文件失败: {e}")

    # ─── 工具方法 ───

    def _is_mentioned(self, content: str) -> bool:
        """检测是否被 @"""
        if not self.mention_pattern:
            return False
        try:
            return bool(re.search(self.mention_pattern, content, re.IGNORECASE))
        except re.error:
            # 兜底：直接字符串匹配
            if self.bot_name:
                return f"@{self.bot_name}" in content
            return "@1052" in content or "@机器人" in content

    def _remove_mention(self, content: str) -> str:
        """移除 @ 标记"""
        if not self.mention_pattern:
            return content
        try:
            return re.sub(self.mention_pattern, "", content, flags=re.IGNORECASE).strip()
        except re.error:
            if self.bot_name:
                return content.replace(f"@{self.bot_name}", "").strip()
            return content.replace("@1052", "").replace("@机器人", "").strip()

    def _remove_thinking_tags(self, text: str) -> str:
        """移除思考标签"""
        text = re.sub(r'<result>[\s\S]*?</result>', '', text)
        text = re.sub(r'<thinking>[\s\S]*?</thinking>', '', text)
        return text.strip()

    # ─── 外部工具接口（供 AI 工具调用） ───

    async def wx_send_message(self, target: str, message: str) -> str:
        """发送微信消息"""
        await self.send_to_chat(target, message)
        return f"✅ 已发送消息给 {target}"

    async def wx_get_groups(self) -> str:
        """获取群聊列表"""
        try:
            engine, version = _get_engine()
            if version == '4.x':
                from pyweixin.WeChatAuto import Messages
                result = await asyncio.to_thread(
                    Messages.get_friends_detail, close_weixin=False
                )
            else:
                from pywechat.WechatAuto import Messages
                result = await asyncio.to_thread(
                    Messages.get_groups_info, close_wechat=False
                )
            return str(result)[:3000]
        except Exception as e:
            return f"获取群聊列表失败: {e}"

    async def wx_get_contacts(self) -> str:
        """获取联系人列表"""
        try:
            engine, version = _get_engine()
            if version == '4.x':
                from pyweixin.WeChatAuto import Messages
                result = await asyncio.to_thread(
                    Messages.get_friends_detail, close_weixin=False
                )
            else:
                from pywechat.WechatAuto import Messages
                result = await asyncio.to_thread(
                    Messages.get_friends_detail, close_wechat=False
                )
            return str(result)[:3000]
        except Exception as e:
            return f"获取联系人失败: {e}"

    async def wx_get_status(self) -> str:
        """获取监听状态"""
        lines = [f"主监听窗口: {self.primary_chat}"]
        lines.append(f"监听状态: {'运行中' if self._enabled else '已停止'}")
        if self._monitored_groups:
            lines.append(f"监听中的群聊: {', '.join(self._monitored_groups.keys())}")
        else:
            lines.append("未监听其他群聊")
        return "\n".join(lines)
