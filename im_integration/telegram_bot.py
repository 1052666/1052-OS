"""
Telegram Bot 集成 - 支持流式输出
"""

import asyncio
import json
import re
from typing import Callable, Optional
from pathlib import Path

try:
    from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
    from telegram.ext import (
        Application, CommandHandler, MessageHandler,
        CallbackQueryHandler, ContextTypes, filters
    )
    TELEGRAM_AVAILABLE = True
except ImportError:
    TELEGRAM_AVAILABLE = False

from core.config import DATA_DIR
from .evolution_v2 import evolution_manager_v2 as evolution_manager

# 文件存储目录
UPLOAD_DIR = DATA_DIR / "2222"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def remove_thinking_tags(text: str) -> str:
    """移除思考标签及其内容"""
    return re.sub(r"<think>[\s\S]*?</think>", "", text)


def markdown_to_html(text: str) -> str:
    """
    将 Markdown 转换为 Telegram HTML 格式

    支持的 Markdown 标签:
    - **bold** -> <b>bold</b>
    - *italic* -> <i>italic</i>
    - `code` -> <code>code</code>
    - ```code block``` -> <pre>code block</pre>
    - [text](url) -> <a href="url">text</a>
    - # heading -> <b>heading</b>
    - - list -> • list
    - > quote -> <blockquote>quote</blockquote>
    """
    import html

    # 转义 HTML 特殊字符
    text = html.escape(text)

    # 代码块 (必须在其他转换之前)
    text = re.sub(r'```(\w*)\n([\s\S]*?)```', r'<pre>\2</pre>', text)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)

    # 粗体和斜体
    text = re.sub(r'\*\*\*([^\*]+)\*\*\*', r'<b><i>\1</i></b>', text)
    text = re.sub(r'\*\*([^\*]+)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'\*([^\*]+)\*', r'<i>\1</i>', text)
    text = re.sub(r'___([^_]+)___', r'<b><i>\1</i></b>', text)
    text = re.sub(r'__([^_]+)__', r'<b>\1</b>', text)
    text = re.sub(r'_([^_]+)_', r'<i>\1</i>', text)

    # 链接
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)

    # 标题
    text = re.sub(r'^### (.+)$', r'<b>\1</b>', text, flags=re.MULTILINE)
    text = re.sub(r'^## (.+)$', r'<b>\1</b>', text, flags=re.MULTILINE)
    text = re.sub(r'^# (.+)$', r'<b>\1</b>', text, flags=re.MULTILINE)

    # 列表
    text = re.sub(r'^- (.+)$', r'• \1', text, flags=re.MULTILINE)
    text = re.sub(r'^\* (.+)$', r'• \1', text, flags=re.MULTILINE)

    # 引用
    text = re.sub(r'^> (.+)$', r'<blockquote>\1</blockquote>', text, flags=re.MULTILINE)

    # 删除线
    text = re.sub(r'~~([^~]+)~~', r'\1', text)

    # 换行处理 - 确保换行被正确显示
    text = text.replace('\n', '\n')

    return text


def strip_html_tags(text: str) -> str:
    """移除所有 HTML 标签，保留纯文本（用于 parse error 的 fallback）"""
    return re.sub(r'</?[a-zA-Z][^>]*>', '', text)


class TelegramBot:
    """Telegram 机器人，支持流式回复和文件处理"""

    # 打断管理：user_id -> cancel_event
    _cancel_events: dict[int, asyncio.Event] = {}

    def __init__(self, token: str, chat_handler: Optional[Callable] = None):
        self.token = token
        self.chat_handler = chat_handler
        self.app: Optional[Application] = None
        self._task: Optional[asyncio.Task] = None
        self._enabled = False
        self._max_retries = 3
        self._retry_delay = 1.0
        self._active_chats: dict[int, float] = {}  # chat_id -> last_active timestamp

    @property
    def enabled(self) -> bool:
        return self._enabled and TELEGRAM_AVAILABLE

    def get_health(self) -> dict:
        """获取健康状态"""
        return {
            "enabled": self.enabled,
            "app_initialized": self.app is not None,
            "updater_running": self.app and self.app.updater and self.app.updater.running if self.app else False,
            "token_set": bool(self.token)
        }

    async def send_alert(self, text: str):
        """向所有活跃会话发送告警通知"""
        if not self.app or not self._active_chats:
            return
        for chat_id in list(self._active_chats.keys()):
            try:
                await self.app.bot.send_message(chat_id=chat_id, text=text, parse_mode="HTML")
            except Exception as e:
                print(f"[Telegram] 告警发送失败 (chat_id={chat_id}): {e}")

    async def start(self):
        """启动机器人"""
        if not TELEGRAM_AVAILABLE:
            print("[Telegram] python-telegram-bot 未安装，跳过")
            return
        if not self.token:
            print("[Telegram] Token 未配置")
            return

        try:
            self.app = Application.builder().token(self.token).build()

            # 注册处理器
            self.app.add_handler(CommandHandler("start", self._cmd_start))
            self.app.add_handler(CommandHandler("1052", self._cmd_menu))  # 命令菜单
            self.app.add_handler(CommandHandler("help", self._cmd_help))
            self.app.add_handler(CommandHandler("new", self._cmd_new))
            self.app.add_handler(CommandHandler("compress", self._cmd_compress))  # 压缩上下文
            self.app.add_handler(CommandHandler("evolve", self._cmd_evolution))
            self.app.add_handler(CommandHandler("stop", self._cmd_stop))
            self.app.add_handler(CallbackQueryHandler(self._callback_handler))

            # 文字消息处理器
            self.app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self._handle_text_message))
            # 图片处理器
            self.app.add_handler(MessageHandler(filters.PHOTO & ~filters.COMMAND, self._handle_photo_message))
            # 文档/文件处理器
            self.app.add_handler(MessageHandler(filters.Document.ALL & ~filters.COMMAND, self._handle_document_message))
            # 音频处理器
            self.app.add_handler(MessageHandler(filters.AUDIO & ~filters.COMMAND, self._handle_audio_message))
            # 视频处理器
            self.app.add_handler(MessageHandler(filters.VIDEO & ~filters.COMMAND, self._handle_video_message))
            # 语音处理器
            self.app.add_handler(MessageHandler(filters.VOICE & ~filters.COMMAND, self._handle_voice_message))

            # 启动轮询
            await self.app.initialize()
            await self.app.start()
            self._task = asyncio.create_task(self.app.updater.start_polling(drop_pending_updates=True))
            self._enabled = True
            print(f"[Telegram] 机器人已启动")

        except Exception as e:
            print(f"[Telegram] 启动失败: {e}")

    async def stop(self):
        """停止机器人"""
        if self.app and self._enabled:
            # 先取消 polling 任务
            if self._task:
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass
                self._task = None

            # 先调用 app.stop()（会正确停止 updater 和所有 handlers）
            try:
                await self.app.stop()
            except Exception as e:
                print(f"[Telegram] app.stop 异常: {e}")

            # 再调用 shutdown
            try:
                await self.app.shutdown()
            except RuntimeError as e:
                # "This Updater is still running!" - 可以忽略，因为 stop() 已经处理了
                if "still running" not in str(e):
                    raise
                print(f"[Telegram] updater 仍在运行，已通过 stop() 处理")
            except Exception as e:
                print(f"[Telegram] app.shutdown 异常: {e}")

            self._enabled = False
            print("[Telegram] 机器人已停止")

    async def _cmd_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """/start 命令"""
        await update.message.reply_text(
            "🤖 你好！我是 1052 助理\n\n"
            "直接发送消息开始对话\n\n"
            "/new — 新建对话，清空上下文\n"
            "/compress — 压缩对话历史（AI 摘要）\n"
            "/evolve — 开启进化模式（自主思考）\n"
            "/stop — 停止进化模式\n"
            "/1052 — 查看命令菜单\n"
            "/help — 查看帮助",
            parse_mode="HTML"
        )

    async def _cmd_menu(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """/1052 命令 - 显示命令菜单"""
        menu_text = (
            "📋 <b>1052 可用命令</b>\n\n"
            "<code>/new</code> — 新建对话，清空上下文\n"
            "<code>/compress</code> — 压缩对话历史（AI 摘要）\n"
            "<code>/evolve</code> — 开启进化模式（自主思考）\n"
            "<code>/stop</code> — 停止进化模式\n"
            "<code>/help</code> — 查看帮助\n\n"
            "直接发送消息与我对话"
        )
        await update.message.reply_text(menu_text, parse_mode="HTML")

    async def _cmd_help(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """/help 命令"""
        await update.message.reply_text(
            "📖 <b>使用帮助</b>\n\n"
            "直接发送文字消息与我对话\n"
            "支持流式输出、图片、文件\n\n"
            "<b>命令：</b>\n"
            "/new — 新建对话，清空上下文\n"
            "/compress — 压缩对话历史（AI 摘要）\n"
            "/evolve — 开启进化模式（自主思考）\n"
            "/stop — 停止进化模式\n"
            "/1052 — 查看命令菜单\n\n"
            "来自 1052 AI Agent",
            parse_mode="HTML"
        )

    async def _cmd_new(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """/new 命令 - 清空对话"""
        user_id = update.effective_user.id

        # 使用 AgentRuntime 清空会话
        from core.agent_runtime import get_agent_runtime
        runtime = get_agent_runtime()
        runtime.clear_session(platform="telegram", user_id=str(user_id))

        await update.message.reply_text("✅ 已新建对话，历史已清空", parse_mode="HTML")


    async def _cmd_compress(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """/compress 命令 - 压缩上下文"""
        user_id = update.effective_user.id
        chat_id = update.effective_chat.id

        # 启动后台压缩任务
        asyncio.create_task(self._compress_context_task(str(user_id), chat_id))

    async def _compress_context_task(self, user_id: str, chat_id: int):
        """后台压缩上下文任务（使用 AgentRuntime）"""
        try:
            bot = self.app.bot

            await bot.send_message(
                chat_id=chat_id,
                text="🔄 <b>正在压缩上下文...</b>\n\n⏱️ 预计需要 1-2 分钟，请稍候...",
                parse_mode="HTML"
            )

            from core.agent_runtime import get_agent_runtime
            runtime = get_agent_runtime()
            result = await runtime.compact_session(platform="telegram", user_id=user_id)

            original = result.get("original_count", 0)
            preserve = result.get("preserve_count", 0)

            if original == 0:
                await bot.send_message(
                    chat_id=chat_id,
                    text="📝 <b>没有消息可压缩</b>",
                    parse_mode="HTML"
                )
                return

            compress_ratio = int((1 - (preserve + 1) / original) * 100) if original > 0 else 0

            await bot.send_message(
                chat_id=chat_id,
                text="✅ <b>上下文压缩完成！</b>\n\n"
                     f"📊 <b>压缩结果：</b>\n"
                     f"• 原始消息数：{original} 条\n"
                     f"• 压缩后：1 条摘要 + {preserve} 条最近对话\n"
                     f"• 压缩比：约 {compress_ratio}%\n\n"
                     "🔄 您可以继续对话，上下文已精简。",
                parse_mode="HTML"
            )

        except Exception as e:
            print(f"[Telegram] 压缩上下文异常: {e}")
            await self.app.bot.send_message(
                chat_id=chat_id,
                text=f"❌ <b>压缩失败</b>：{str(e)[:100]}",
                parse_mode="HTML"
            )

    async def _cmd_evolution(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """/evolve 命令 - 开启或触发进化"""
        user_id = str(update.effective_user.id)
        evolution_manager.set_user("telegram", user_id)
        result = await evolution_manager.trigger()
        await update.message.reply_text(result)

    async def _cmd_stop(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """/stop 命令 - 停止进化模式"""
        result = await evolution_manager.stop()
        await update.message.reply_text(result)

    async def _callback_handler(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """按钮回调处理"""
        query = update.callback_query
        await query.answer()

    async def _handle_text_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """处理文字消息"""
        user_id = update.effective_user.id

        # 打断当前处理
        self._signal_cancel(user_id)

        await self._process_message(update, context, message_text=update.message.text, message_type="text")

    async def _handle_photo_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """处理图片消息"""
        user_id = update.effective_user.id
        # 打断当前处理
        self._signal_cancel(user_id)

        # 获取最大分辨率的图片
        photo = update.message.photo[-1]
        file = await context.bot.get_file(photo.file_id)

        # 保存图片
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        ext = "jpg"
        filename = f"photo_{timestamp}.{ext}"
        filepath = UPLOAD_DIR / filename

        await file.download_to_drive(custom_path=str(filepath))

        message_text = f"[用户发送了一张图片，已保存到 {filename}]"
        await self._process_message(update, context, message_text=message_text, message_type="photo", file_path=str(filepath))

    async def _handle_document_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """处理文档消息"""
        user_id = update.effective_user.id
        # 打断当前处理
        self._signal_cancel(user_id)

        doc = update.message.document
        file = await context.bot.get_file(doc.file_id)

        # 获取文件名
        filename = doc.file_name or f"document_{doc.file_id}"
        filepath = UPLOAD_DIR / filename

        await file.download_to_drive(custom_path=str(filepath))

        message_text = f"[用户发送了文件 {filename}，已保存到 data/2222/]"
        await self._process_message(update, context, message_text=message_text, message_type="document", file_path=str(filepath))

    async def _handle_audio_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """处理音频消息"""
        user_id = update.effective_user.id
        # 打断当前处理
        self._signal_cancel(user_id)

        audio = update.message.audio
        file = await context.bot.get_file(audio.file_id)

        filename = audio.file_name or f"audio_{audio.file_id}.mp3"
        filepath = UPLOAD_DIR / filename

        await file.download_to_drive(custom_path=str(filepath))

        message_text = f"[用户发送了音频 {filename}，已保存到 data/2222/]"
        await self._process_message(update, context, message_text=message_text, message_type="audio", file_path=str(filepath))

    async def _handle_video_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """处理视频消息"""
        user_id = update.effective_user.id
        # 打断当前处理
        self._signal_cancel(user_id)

        video = update.message.video
        file = await context.bot.get_file(video.file_id)

        filename = video.file_name or f"video_{video.file_id}.mp4"
        filepath = UPLOAD_DIR / filename

        await file.download_to_drive(custom_path=str(filepath))

        message_text = f"[用户发送了视频 {filename}，已保存到 data/2222/]"
        await self._process_message(update, context, message_text=message_text, message_type="video", file_path=str(filepath))

    async def _handle_voice_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """处理语音消息"""
        user_id = update.effective_user.id
        # 打断当前处理
        self._signal_cancel(user_id)
        voice = update.message.voice
        file = await context.bot.get_file(voice.file_id)

        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"voice_{timestamp}.ogg"
        filepath = UPLOAD_DIR / filename

        await file.download_to_drive(custom_path=str(filepath))

        message_text = f"[用户发送了语音消息，已保存到 data/2222/{filename}]"
        await self._process_message(update, context, message_text=message_text, message_type="voice", file_path=str(filepath))

    def _signal_cancel(self, user_id: int):
        """打断指定用户的当前处理"""
        old_event = self._cancel_events.get(user_id)
        if old_event:
            old_event.set()

    async def _process_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE, message_text: str, message_type: str = "text", file_path: str = None):
        """处理消息的核心逻辑（使用 AgentRuntime）"""
        import os

        if not self.chat_handler:
            await update.message.reply_text("❌ 聊天处理未配置", parse_mode="HTML")
            return

        user_id = update.effective_user.id
        chat_id = update.effective_chat.id

        # 记录活跃会话 (供告警通知使用)
        import time as _time
        self._active_chats[chat_id] = _time.time()

        # 发送"正在输入"状态
        await context.bot.send_chat_action(chat_id=chat_id, action="typing")

        # 创建本处理的取消事件
        cancel_event = asyncio.Event()
        self._cancel_events[user_id] = cancel_event

        # 构建消息内容
        content = message_text
        if file_path and message_type in ["photo", "document", "attachment"]:
            content = f"{message_text}\n[文件路径: {file_path}]"

        # 只传新用户消息 + 用户信息，AgentRuntime 负责加载会话历史
        messages = [
            {"role": "system", "content": f"[用户信息] platform=telegram, user_id={user_id}"},
            {"role": "user", "content": content}
        ]

        # 创建初始回复消息
        reply_msg = await update.message.reply_text("💭 思考中...", parse_mode="HTML")

        # 检查是否在开始前就被打断了
        if cancel_event.is_set():
            await self._edit_with_retry(reply_msg, "⚠️ 已被新消息打断", parse_mode="HTML")
            return

        # 流式处理
        full_response = ""
        last_update_len = 0
        update_interval = 0.5
        last_update_time = asyncio.get_event_loop().time()

        try:
            async for chunk in self.chat_handler(messages, cancel_event=cancel_event):
                # 检查取消
                if cancel_event.is_set():
                    await self._edit_with_retry(reply_msg, "⚠️ 已被新消息打断", parse_mode="HTML")
                    return

                chunk_type = chunk.get("type")
                print(f"[TG Bot] 收到 chunk: type={chunk_type}, content={str(chunk)[:200]}")

                # chat_engine 检测到取消
                if chunk_type == "cancelled":
                    await self._edit_with_retry(reply_msg, "⚠️ 已被新消息打断", parse_mode="HTML")
                    return

                # 跳过 context_update（AgentRuntime 自行管理会话）
                if chunk_type == "context_update":
                    continue

                if chunk_type == "delta":
                    content = chunk.get("content", "")
                    full_response += content

                    # 节流更新，避免频繁编辑
                    current_time = asyncio.get_event_loop().time()
                    if current_time - last_update_time >= update_interval:
                        display_text = remove_thinking_tags(full_response[-3800:])
                        display_html = markdown_to_html(display_text) + "▌"
                        if len(display_text) > last_update_len + 10:
                            await self._edit_with_retry(reply_msg, display_html, parse_mode="HTML")
                            last_update_len = len(display_text)
                            last_update_time = current_time

                elif chunk_type == "tool_call":
                    tool_name = chunk.get("name", "")
                    print(f"[TG Bot] 工具调用: {tool_name}")
                    display_text = remove_thinking_tags(full_response[-3800:])
                    tool_msg = f"{display_text}\n\n🔧 使用工具: {tool_name}..."
                    await self._edit_with_retry(reply_msg, tool_msg, parse_mode="HTML")

                elif chunk_type == "tool_result":
                    result_content = str(chunk.get("result", ""))
                    print(f"[TG Bot] 工具结果: {result_content[:200]}")

                    tg_file_match = re.search(r'\[TG_FILE:([^\]]+)\]', result_content)
                    if tg_file_match:
                        file_path = tg_file_match.group(1)
                        await self._send_local_file(context.bot, chat_id, file_path)

                    display_text = remove_thinking_tags(full_response[-3800:])
                    thinking_msg = display_text + "\n\n💭 继续思考中..."
                    await self._edit_with_retry(reply_msg, thinking_msg, parse_mode="HTML")
                    await context.bot.send_chat_action(chat_id=chat_id, action="typing")

                elif chunk_type == "file":
                    file_path = chunk.get("url", "")
                    caption = chunk.get("caption", "")
                    await self._send_local_file(context.bot, chat_id, file_path, caption)

                elif chunk_type == "error":
                    print(f"[TG Bot] 错误: {chunk.get('content', '')}")
                    error_text = f"❌ 错误: {chunk.get('content', '')}"
                    await self._edit_with_retry(reply_msg, error_text, parse_mode="HTML")
                    return

                elif chunk_type == "done":
                    print(f"[TG Bot] 流式结束")

            # ── 最终更新 ──
            final_text = remove_thinking_tags(full_response[-3800:]) if full_response else "（无回复）"

            print(f"[TG Bot] final_text 长度: {len(final_text)}")
            print(f"[TG Bot] final_text 内容预览: {final_text[:500]}")

            all_files = []

            tg_file_pattern = re.findall(r'\[TG_FILE:([^\]]+)\]', final_text)
            for f in tg_file_pattern:
                all_files.append(("tg_file", f))

            file_url_pattern = re.findall(r'\[FILE_URL:/files/([^\]]+)\]', final_text)
            for f in file_url_pattern:
                all_files.append(("file_url", f))

            md_link_pattern = re.findall(r'\[([^\]]+)\]\(/files/([^)]+)\)', final_text)
            for filename, url_path in md_link_pattern:
                all_files.append(("md_link", (filename, url_path)))

            print(f"[TG Bot] 找到文件: {all_files}")

            for file_info in all_files:
                file_type = file_info[0]
                file_path = None

                if file_type == "tg_file":
                    file_path = file_info[1]
                elif file_type == "file_url":
                    file_path = file_info[1]
                elif file_type == "md_link":
                    file_path = file_info[1][1]

                if file_path:
                    await self._send_local_file(context.bot, chat_id, file_path)

            final_text = re.sub(r'\[TG_FILE:[^\]]+\]\n?', '', final_text)
            final_text = re.sub(r'\[FILE_URL:/files/[^\]]+\]\n?', '', final_text)
            final_text = re.sub(r'\[([^\]]+)\]\(/files/[^)]+\)\n?', '', final_text)
            print(f"[TG Bot] 移除链接后 final_text: {final_text[:500]}")
            final_text = final_text.strip()

            if not final_text:
                final_text = "（无回复）"

            final_html = markdown_to_html(final_text)

            success = await self._edit_with_retry(reply_msg, final_html, parse_mode="HTML")
            if not success:
                await self._send_with_retry(chat_id, final_html, parse_mode="HTML")

            # AgentRuntime 已自动保存会话，无需手动保存

        except Exception as e:
            await self._edit_with_retry(reply_msg, f"❌ 处理失败: {str(e)}", parse_mode="HTML")
        finally:
            pass

    async def _send_local_file(self, bot, chat_id: int, file_path: str, caption: str = ""):
        """
        根据文件类型发送本地文件到 Telegram
        支持: 图片(.png/.jpg/.jpeg/.gif/.webp)、视频(.mp4/.avi/.mov/.mkv)、音频(.mp3/.wav/.ogg/.m4a)、文档
        """
        import os

        # 解析文件路径
        if not file_path:
            return

        # 如果是 /files/xxx 格式，转换为本地路径
        if file_path.startswith("/files/"):
            filename = file_path[8:]
            local_path = str(DATA_DIR / "1111" / filename)
        elif file_path.startswith("data/1111/"):
            local_path = str(DATA_DIR / file_path[5:])
        elif not os.path.isabs(file_path):
            local_path = str(DATA_DIR / "1111" / file_path)
        else:
            local_path = file_path

        local_path = os.path.normpath(local_path)

        if not os.path.exists(local_path):
            print(f"[TG Bot] 文件不存在: {local_path}")
            return

        try:
            filename_lower = local_path.lower()
            if filename_lower.endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp')):
                # sendPhoto - 图片最大 10MB
                await bot.send_photo(chat_id=chat_id, photo=local_path, caption=caption)
                print(f"[TG Bot] 图片发送成功: {local_path}")
            elif filename_lower.endswith(('.mp4', '.avi', '.mov', '.mkv')):
                # sendVideo - 视频最大 50MB
                await bot.send_video(chat_id=chat_id, video=local_path, caption=caption)
                print(f"[TG Bot] 视频发送成功: {local_path}")
            elif filename_lower.endswith(('.mp3', '.wav', '.m4a')):
                # sendAudio - MP3/M4A 格式
                await bot.send_audio(chat_id=chat_id, audio=local_path, caption=caption)
                print(f"[TG Bot] 音频发送成功: {local_path}")
            elif filename_lower.endswith(('.ogg',)):
                # sendVoice - OGG 格式，语音消息
                await bot.send_voice(chat_id=chat_id, voice=local_path, caption=caption)
                print(f"[TG Bot] 语音消息发送成功: {local_path}")
            else:
                # sendDocument - 其他所有文件
                await bot.send_document(chat_id=chat_id, document=local_path, caption=caption)
                print(f"[TG Bot] 文档发送成功: {local_path}")
        except Exception as e:
            print(f"[TG Bot] 文件发送失败: {e}")

    async def _edit_with_retry(self, message, text: str, parse_mode: str = None, max_retries: int = 3) -> bool:
        """
        带重试的 edit_text，支持消息过长时自动截断和 parse error 时降级

        Returns:
            True if successful, False otherwise
        """
        # Telegram 消息限制 4096 字符
        MAX_MSG_LEN = 4096

        for attempt in range(max_retries):
            try:
                # 如果消息过长，截断
                if len(text) > MAX_MSG_LEN:
                    text = text[:MAX_MSG_LEN - 20] + "\n...(内容过长已截断)"

                if parse_mode:
                    await message.edit_text(text, parse_mode=parse_mode)
                else:
                    await message.edit_text(text)
                return True
            except Exception as e:
                error_str = str(e).lower()
                # 检查是否是消息过长错误
                if 'too long' in error_str or 'message too long' in error_str:
                    # 再次截断后重试
                    text = text[:MAX_MSG_LEN - 50] + "\n...(内容过长已截断)"
                    try:
                        if parse_mode:
                            await message.edit_text(text, parse_mode=parse_mode)
                        else:
                            await message.edit_text(text)
                        return True
                    except:
                        return False

                # 检查是否是 parse error（标签不匹配等）
                if 'parse' in error_str or 'entity' in error_str or 'unmatched' in error_str or 'end tag' in error_str:
                    print(f"[TG Bot] edit_text parse error，尝试降级为纯文本: {e}")
                    # 降级为纯文本（移除所有 HTML 标签）
                    plain_text = strip_html_tags(text)
                    if len(plain_text) > MAX_MSG_LEN:
                        plain_text = plain_text[:MAX_MSG_LEN - 20] + "\n...(内容过长已截断)"
                    try:
                        await message.edit_text(plain_text, parse_mode=None)
                        return True
                    except Exception as e2:
                        print(f"[TG Bot] 降级为纯文本也失败: {e2}")
                        return False

                if any(kw in error_str for kw in ['timeout', 'network', 'connection', 'read', 'write', 'httpx', 'retry']):
                    print(f"[TG Bot] edit_text 重试 ({attempt + 1}/{max_retries}): {e}")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(1.0 * (attempt + 1))
                    else:
                        print(f"[TG Bot] edit_text 最终失败: {e}")
                        return False
                else:
                    # 非网络错误，不重试
                    print(f"[TG Bot] edit_text 失败（不重试）: {e}")
                    return False
        return False

    async def _send_with_retry(self, chat_id: int, text: str, parse_mode: str = None, max_retries: int = 3) -> bool:
        """
        带重试的 send_message，支持 parse error 时降级

        Returns:
            True if successful, False otherwise
        """
        bot = self.app.bot
        MAX_MSG_LEN = 4096

        # 如果消息过长，截断
        if len(text) > MAX_MSG_LEN:
            text = text[:MAX_MSG_LEN - 20] + "\n...(内容过长已截断)"

        for attempt in range(max_retries):
            try:
                if parse_mode:
                    await bot.send_message(chat_id=chat_id, text=text, parse_mode=parse_mode)
                else:
                    await bot.send_message(chat_id=chat_id, text=text)
                return True
            except Exception as e:
                error_str = str(e).lower()

                # 检查是否是 parse error
                if 'parse' in error_str or 'entity' in error_str or 'unmatched' in error_str or 'end tag' in error_str:
                    print(f"[TG Bot] send_message parse error，尝试降级为纯文本: {e}")
                    plain_text = strip_html_tags(text)
                    try:
                        await bot.send_message(chat_id=chat_id, text=plain_text, parse_mode=None)
                        return True
                    except Exception as e2:
                        print(f"[TG Bot] 降级为纯文本也失败: {e2}")
                        return False

                if any(kw in error_str for kw in ['timeout', 'network', 'connection', 'read', 'write', 'httpx', 'retry']):
                    print(f"[TG Bot] send_message 重试 ({attempt + 1}/{max_retries}): {e}")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(1.0 * (attempt + 1))
                    else:
                        print(f"[TG Bot] send_message 最终失败: {e}")
                        return False
                else:
                    print(f"[TG Bot] send_message 失败（不重试）: {e}")
                    return False
        return False
