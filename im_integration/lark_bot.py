"""
飞书(Lark) Bot 集成 - 长连接模式，使用交互式卡片
"""

import asyncio
import json
import re
import os
import time
from typing import Callable, Optional

try:
    import lark_oapi as lark
    from lark_oapi import Client
    from lark_oapi.ws import Client as WSClient
    from lark_oapi.event.dispatcher_handler import EventDispatcherHandler
    from lark_oapi.api.im.v1 import (
        CreateMessageRequest, CreateMessageRequestBody,
        UpdateMessageRequest, UpdateMessageRequestBody,
        CreateImageRequest, CreateImageRequestBody,
        CreateFileRequest, CreateFileRequestBody
    )
    LARK_AVAILABLE = True
except ImportError as e:
    print(f"[Lark] lark-oapi 导入失败: {e}")
    LARK_AVAILABLE = False

import requests

from core.config import DATA_DIR


class FeishuFileClient:
    """
    飞书文件发送客户端 - 基于 HTTP API 实现，支持 token 缓存

    文档: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/file/upload
    """

    def __init__(self, app_id: str, app_secret: str):
        self.app_id = app_id
        self.app_secret = app_secret
        self._token = None
        self._token_expire_at = 0

    def _get_tenant_access_token(self) -> str:
        """获取 tenant_access_token，带缓存机制"""
        now = time.time()
        if self._token and now < self._token_expire_at - 60:
            return self._token

        resp = requests.post(
            "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
            json={"app_id": self.app_id, "app_secret": self.app_secret},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("code") != 0:
            raise RuntimeError(f"获取 token 失败: {data}")

        self._token = data["tenant_access_token"]
        self._token_expire_at = now + data.get("expire", 7200)
        return self._token

    def _auth_headers(self) -> dict:
        """认证请求头"""
        return {"Authorization": f"Bearer {self._get_tenant_access_token()}"}

    def _json_headers(self) -> dict:
        """JSON 请求头"""
        return {
            "Authorization": f"Bearer {self._get_tenant_access_token()}",
            "Content-Type": "application/json",
        }

    def upload_file(self, file_path: str) -> str:
        """
        上传普通文件，获取 file_key

        适用于: PDF、Word、Excel、ZIP、音频、视频 等

        Args:
            file_path: 文件本地路径

        Returns:
            file_key 字符串
        """
        file_name = os.path.basename(file_path)

        with open(file_path, "rb") as f:
            resp = requests.post(
                "https://open.feishu.cn/open-apis/im/v1/files",
                headers=self._auth_headers(),
                files={"file": (file_name, f)},
                data={
                    "file_type": "stream",
                    "file_name": file_name,
                },
                timeout=60,
            )

        resp.raise_for_status()
        data = resp.json()

        if data.get("code") != 0:
            raise RuntimeError(f"上传文件失败: {data}")

        return data["data"]["file_key"]

    def upload_image(self, image_path: str) -> str:
        """
        上传图片，获取 image_key

        适用于: JPG、PNG、GIF、WebP 等

        Args:
            image_path: 图片本地路径

        Returns:
            image_key 字符串
        """
        with open(image_path, "rb") as f:
            resp = requests.post(
                "https://open.feishu.cn/open-apis/im/v1/images",
                headers=self._auth_headers(),
                files={"image": f},
                data={"image_type": "message"},
                timeout=60,
            )

        resp.raise_for_status()
        data = resp.json()

        if data.get("code") != 0:
            raise RuntimeError(f"上传图片失败: {data}")

        return data["data"]["image_key"]

    def send_file_message(self, receive_id: str, receive_id_type: str, file_key: str) -> dict:
        """
        发送文件消息

        Args:
            receive_id: 接收方 ID (chat_id 或 open_id)
            receive_id_type: 接收ID类型 ("chat_id" 或 "open_id")
            file_key: 文件 key

        Returns:
            API 响应
        """
        resp = requests.post(
            "https://open.feishu.cn/open-apis/im/v1/messages",
            params={"receive_id_type": receive_id_type},
            headers=self._json_headers(),
            json={
                "receive_id": receive_id,
                "msg_type": "file",
                "content": json.dumps({"file_key": file_key}),
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("code") != 0:
            raise RuntimeError(f"发送文件消息失败: {data}")

        return data

    def send_image_message(self, receive_id: str, receive_id_type: str, image_key: str) -> dict:
        """
        发送图片消息

        Args:
            receive_id: 接收方 ID (chat_id 或 open_id)
            receive_id_type: 接收ID类型 ("chat_id" 或 "open_id")
            image_key: 图片 key

        Returns:
            API 响应
        """
        resp = requests.post(
            "https://open.feishu.cn/open-apis/im/v1/messages",
            params={"receive_id_type": receive_id_type},
            headers=self._json_headers(),
            json={
                "receive_id": receive_id,
                "msg_type": "image",
                "content": json.dumps({"image_key": image_key}),
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("code") != 0:
            raise RuntimeError(f"发送图片消息失败: {data}")

        return data

    def send_text_message(self, receive_id: str, receive_id_type: str, text: str) -> dict:
        """
        发送文本消息

        Args:
            receive_id: 接收方 ID
            receive_id_type: 接收ID类型
            text: 文本内容

        Returns:
            API 响应
        """
        resp = requests.post(
            "https://open.feishu.cn/open-apis/im/v1/messages",
            params={"receive_id_type": receive_id_type},
            headers=self._json_headers(),
            json={
                "receive_id": receive_id,
                "msg_type": "text",
                "content": json.dumps({"text": text}, ensure_ascii=False),
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("code") != 0:
            raise RuntimeError(f"发送文本消息失败: {data}")

        return data

    def download_message_resource(self, message_id: str, file_key: str, file_type: str = "image") -> Optional[bytes]:
        """
        下载消息中的资源（图片、文件等）

        Args:
            message_id: 消息 ID
            file_key: 文件 key
            file_type: 资源类型 (image/file/audio/video)

        Returns:
            文件二进制内容，失败返回 None
        """
        try:
            token = self._get_tenant_access_token()
            url = f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}/resources/{file_key}"
            params = {"type": file_type}

            resp = requests.get(
                url,
                headers={"Authorization": f"Bearer {token}"},
                params=params,
                timeout=30,
            )
            resp.raise_for_status()
            return resp.content
        except Exception as e:
            print(f"[FeishuFileClient] 下载资源失败: {e}")
            return None


class LarkBot:
    """飞书机器人，长连接模式，使用交互式卡片"""

    # 打断管理
    _cancel_events: dict[str, asyncio.Event] = {}

    def __init__(
        self,
        app_id: str,
        app_secret: str,
        encrypt_key: Optional[str] = None,
        verification_token: Optional[str] = None,
        chat_handler: Optional[Callable] = None
    ):
        self.app_id = app_id
        self.app_secret = app_secret
        self.encrypt_key = encrypt_key
        self.verification_token = verification_token
        self.chat_handler = chat_handler
        self.client: Optional[Client] = None
        self.ws_client = None
        self._enabled = False
        self._task: Optional[asyncio.Task] = None
        self._file_client: Optional[FeishuFileClient] = None
        self._active_chats: dict[str, tuple[str, float]] = {}  # receive_id -> (receive_id_type, last_active)

    @property
    def enabled(self) -> bool:
        return self._enabled and LARK_AVAILABLE

    def get_health(self) -> dict:
        """获取健康状态"""
        return {
            "enabled": self.enabled,
            "client_initialized": self.client is not None,
            "ws_connected": self.ws_client is not None,
            "file_client_ready": self._file_client is not None,
            "app_id_set": bool(self.app_id),
        }

    async def send_alert(self, text: str):
        """向所有活跃会话发送告警通知"""
        if not self._file_client or not self._active_chats:
            return
        for receive_id, (receive_id_type, _) in list(self._active_chats.items()):
            try:
                self._file_client.send_text_message(receive_id, receive_id_type, text)
            except Exception as e:
                print(f"[Lark] 告警发送失败 (receive_id={receive_id}): {e}")

    async def start(self):
        """启动飞书机器人"""
        if not LARK_AVAILABLE:
            print("[Lark] lark-oapi 未安装，跳过")
            return
        if not self.app_id or not self.app_secret:
            print("[Lark] AppID 或 AppSecret 未配置")
            return

        try:
            self.client = lark.Client.builder() \
                .app_id(self.app_id) \
                .app_secret(self.app_secret) \
                .log_level(lark.LogLevel.INFO) \
                .build()

            # 初始化文件发送客户端
            self._file_client = FeishuFileClient(self.app_id, self.app_secret)

            self._task = asyncio.create_task(self._run_ws())
            self._enabled = True
            print(f"[Lark] 机器人已启动 (AppID: {self.app_id[:8]}...)")

        except Exception as e:
            print(f"[Lark] 启动失败: {e}")

    async def stop(self):
        """停止机器人"""
        if self._task and self._enabled:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._enabled = False
            print("[Lark] 机器人已停止")

    async def _run_ws(self):
        """运行 WebSocket 长连接"""
        try:
            def on_message(data):
                try:
                    asyncio.create_task(self._handle_ws_event(data))
                except Exception as e:
                    print(f"[Lark] 消息处理错误: {e}")

            def on_message_recalled(data):
                try:
                    asyncio.create_task(self._handle_ws_event(data))
                except Exception as e:
                    print(f"[Lark] 消息撤回处理错误: {e}")

            builder = EventDispatcherHandler.builder(
                self.encrypt_key or "",
                self.verification_token or ""
            )
            event_handler = builder \
                .register_p2_im_message_receive_v1(on_message) \
                .register_p2_im_message_recalled_v1(on_message_recalled) \
                .build()

            self.ws_client = WSClient(
                app_id=self.app_id,
                app_secret=self.app_secret,
                log_level=lark.LogLevel.INFO,
                event_handler=event_handler,
            )

            await asyncio.to_thread(self.ws_client.start)

        except Exception as e:
            print(f"[Lark] WebSocket 运行失败: {e}")
            await asyncio.sleep(5)
            if self._enabled:
                self._task = asyncio.create_task(self._run_ws())

    async def _handle_ws_event(self, event):
        """处理 WebSocket 事件"""
        try:
            event_type = ""
            if hasattr(event, "header") and event.header:
                event_type = getattr(event.header, "event_type", "")
            elif isinstance(event, dict):
                event_type = event.get("header", {}).get("event_type", "")

            if event_type == "im.message.receive_v1":
                await self._handle_message(event)
            elif event_type == "im.message.recalled_v1":
                await self._handle_recalled_message(event)

        except Exception as e:
            print(f"[Lark] 事件处理错误: {e}")

    async def _handle_message(self, event_data):
        """处理用户消息"""
        if not self.chat_handler:
            return

        # 提取消息基本信息
        message_id = ""
        if isinstance(event_data, dict):
            event = event_data.get("event", {})
            message = event.get("message", {})
            sender = event.get("sender", {}).get("sender_id", {}).get("open_id", "")
            chat_id = message.get("chat_id", "")
            chat_type = message.get("chat_type", "group")  # "group" 或 "p2p"
            msg_type = message.get("msg_type", "text")
            content = json.loads(message.get("content", "{}"))
            text = content.get("text", "").strip()
            message_id = message.get("message_id", "")
        else:
            event = getattr(event_data, "event", None)
            if not event:
                return
            sender = getattr(getattr(event, "sender", None), "sender_id", None)
            sender = getattr(sender, "open_id", "") or ""
            message = getattr(event, "message", None)
            if not message:
                return
            chat_id = getattr(message, "chat_id", "") or ""
            chat_type = getattr(message, "chat_type", "group") or "group"
            msg_type = getattr(message, "msg_type", "text") or "text"
            raw_content = getattr(message, "content", "{}") or "{}"
            content = json.loads(raw_content)
            text = content.get("text", "").strip()
            message_id = getattr(message, "message_id", "") or ""

        # 确定发送目标：群聊用 chat_id，私信用 open_id
        if chat_type == "p2p":
            receive_id = sender
            receive_id_type = "open_id"
        else:
            receive_id = chat_id
            receive_id_type = "chat_id"

        # 记录活跃会话 (供告警通知使用)
        import time as _time
        self._active_chats[receive_id] = (receive_id_type, _time.time())

        # 处理文件消息（图片、文档等）
        if msg_type in ("file", "image", "audio", "video") and not text:
            await self._handle_file_message(receive_id, receive_id_type, msg_type, content, sender, message_id)
            return

        # 处理 text 类型的图片/文件消息（飞书把图片作为 text 消息发送，内容含 image_key/file_key）
        if msg_type == "text" and content:
            if "image_key" in content:
                await self._handle_file_message(receive_id, receive_id_type, "image", content, sender, message_id)
                return
            if "file_key" in content:
                await self._handle_file_message(receive_id, receive_id_type, "file", content, sender, message_id)
                return

        # 忽略非文本消息（除非是文件）
        if not text:
            print(f"[Lark] 收到未知消息类型: msg_type={msg_type}, content={content}")
            return

        print(f"[Lark] 收到消息: text={text!r}, sender={sender}, chat_type={chat_type}")

        # 处理命令
        if text == "/new":
            from core.agent_runtime import get_agent_runtime
            runtime = get_agent_runtime()
            runtime.clear_session(platform="lark", user_id=sender)
            await self._send_text(receive_id, receive_id_type, "✅ 已新建对话，历史已清空")
            return

        if text in ["/help", "/1052"] or text.startswith("/1052") or text.startswith("/help"):
            card = self._build_help_card()
            await self._send_card(receive_id, receive_id_type, card)
            return

        if text == "/compress":
            # 启动后台压缩任务
            asyncio.create_task(self._compress_context_task(sender, receive_id, receive_id_type))
            return

        if text == "/evolve":
            from im_integration.evolution_v2 import evolution_manager_v2 as evolution_manager
            evolution_manager.set_user("lark", sender)
            result = await evolution_manager.trigger()
            await self._send_text(receive_id, receive_id_type, result)
            return

        if text == "/stop":
            from im_integration.evolution_v2 import evolution_manager_v2 as evolution_manager
            result = await evolution_manager.stop()
            await self._send_text(receive_id, receive_id_type, result)
            return

        # 加载对话历史

        # ── 打断旧的处理 ──
        old_event = self._cancel_events.get(sender)
        if old_event:
            old_event.set()

        # ── 创建本处理的取消事件 ──
        cancel_event = asyncio.Event()
        self._cancel_events[sender] = cancel_event

        # 只传新用户消息 + 用户信息，AgentRuntime 负责加载会话历史
        messages = [
            {"role": "system", "content": f"[用户信息] platform=lark, user_id={sender}"},
            {"role": "user", "content": text}
        ]

        # 设置全局平台信息（供 tools.py 中的定时任务等工具使用）
        from core.tools import set_current_user
        set_current_user("lark", sender)

        # 流式处理 - 使用文本消息进行流式更新
        full_response = ""
        thinking_content = []
        current_tool = None
        streaming_msg_id = None  # 文本消息 ID，用于更新
        last_update_time = 0
        update_interval = 1.5  # 1.5秒更新一次
        tool_call_msg_id = None  # 工具调用消息 ID

        try:
            # 1. 先创建初始文本消息
            print(f"[Lark] 创建流式消息, receive_id={receive_id}, type={receive_id_type}")
            init_text = "正在思考..."
            streaming_msg_id = await self._send_text(receive_id, receive_id_type, init_text)
            print(f"[Lark] 流式消息创建结果: {streaming_msg_id}")

            # 2. 流式处理响应
            async for chunk in self.chat_handler(messages, cancel_event=cancel_event):
                chunk_type = chunk.get("type")
                print(f"[Lark] chunk: type={chunk_type}")

                # ── 取消检查 ──
                if cancel_event.is_set():
                    if streaming_msg_id:
                        await self._update_text_message(streaming_msg_id, "⚠️ 已被新消息打断")
                    return

                # ── 上下文快照（AgentRuntime 自行管理）──
                if chunk_type == "context_update":
                    continue

                if chunk_type == "cancelled":
                    if streaming_msg_id:
                        await self._update_text_message(streaming_msg_id, "⚠️ 已被新消息打断")
                    return

                if chunk_type == "delta":
                    delta = chunk.get("content", "")
                    full_response += delta
                    self._extract_thinking(delta, thinking_content)

                    # 节流更新文本消息（每 1.5秒最多一次）
                    current_time = asyncio.get_event_loop().time()
                    if current_time - last_update_time >= update_interval and streaming_msg_id:
                        display_text = self._remove_thinking_tags(full_response)
                        display_text = display_text[-2000:] if len(display_text) > 2000 else display_text
                        if display_text:
                            print(f"[Lark] 更新消息, 内容长度={len(display_text)}")
                            await self._update_text_message(streaming_msg_id, display_text + "\n\n思考中...")
                        last_update_time = current_time

                elif chunk_type == "tool_call":
                    tool_name = chunk.get("name", "")
                    current_tool = tool_name
                    thinking_content.append(f"调用工具: {tool_name}")

                    # 工具调用时更新消息
                    if streaming_msg_id:
                        display_text = self._remove_thinking_tags(full_response)
                        update_text = (display_text[-1500:] if len(display_text) > 1500 else display_text) if display_text else ""
                        update_text += f"\n\n使用工具: {tool_name}..."
                        await self._update_text_message(streaming_msg_id, update_text)

                elif chunk_type == "tool_result":
                    result_content = str(chunk.get("result", ""))
                    print(f"[Lark] 工具结果: {result_content[:200]}")

                    # 检测 send_to_lark 工具返回的 [LARK_FILE:xxx] 标记
                    lark_file_match = re.search(r'\[LARK_FILE:([^\]]+)\]', result_content)
                    if lark_file_match:
                        file_path = lark_file_match.group(1)
                        await self._send_file(receive_id, receive_id_type, file_path)

                    thinking_content.append("工具执行完成")
                    current_tool = None

                    # 工具结果后更新消息
                    if streaming_msg_id:
                        display_text = self._remove_thinking_tags(full_response)
                        update_text = (display_text[-1500:] if len(display_text) > 1500 else display_text) if display_text else ""
                        update_text += "\n\n工具执行完成，继续思考..."
                        await self._update_text_message(streaming_msg_id, update_text)

                elif chunk_type == "file":
                    file_path = chunk.get("url", "")
                    await self._send_file(receive_id, receive_id_type, file_path)

                elif chunk_type == "error":
                    error_text = f"错误: {chunk.get('content', '')}"
                    if streaming_msg_id:
                        await self._update_text_message(streaming_msg_id, error_text)
                    else:
                        await self._send_text(receive_id, receive_id_type, error_text)
                    return

            # 3. 最终结果 - 发送结果卡片
            print(f"[Lark] 流式处理完成")
            final_display = self._remove_thinking_tags(full_response)

            # 发送结果卡片
            result_card = self._build_result_card(
                final_display,
                thinking_content,
                None,
                "green"
            )
            await self._send_card(receive_id, receive_id_type, result_card)

            # 删除中间的流式消息
            if streaming_msg_id:
                try:
                    from lark_oapi.api.im.v1 import DeleteMessageRequest
                    delete_request = DeleteMessageRequest.builder() \
                        .message_id(streaming_msg_id) \
                        .build()
                    self.client.im.v1.message.delete(delete_request)
                    print(f"[Lark] 删除中间消息成功")
                except Exception as e:
                    print(f"[Lark] 删除中间消息失败: {e}")

        except Exception as e:
            print(f"[Lark] 流式处理异常: {e}")
            import traceback
            traceback.print_exc()
            await self._send_text(receive_id, receive_id_type, f"处理异常: {str(e)[:200]}")

        # AgentRuntime 已自动保存会话，无需手动保存
        pass

    async def _handle_recalled_message(self, event):
        """处理消息撤回事件"""
        try:
            if isinstance(event, dict):
                message = event.get("event", {}).get("message", {})
                operator = event.get("event", {}).get("operator", {})
                operator_id = operator.get("operator_id", {}).get("open_id", "")
            else:
                ev = getattr(event, "event", None)
                if not ev:
                    return
                message = getattr(ev, "message", None)
                if not message:
                    return
                operator = getattr(ev, "operator", None)
                operator_id = ""
                if operator:
                    op_id = getattr(operator, "operator_id", None)
                    if op_id:
                        operator_id = getattr(op_id, "open_id", "") or ""

            if message:
                msg_id = getattr(message, "message_id", "") or message.get("message_id", "")
                print(f"[Lark] 消息被撤回: message_id={msg_id}, 操作者={operator_id}")
        except Exception as e:
            print(f"[Lark] 处理撤回消息异常: {e}")

    async def _handle_file_message(self, receive_id: str, receive_id_type: str, msg_type: str, content: dict, sender: str, message_id: str = ""):
        """处理用户发送的文件消息

        Args:
            receive_id: 接收方 ID
            receive_id_type: 接收ID类型
            msg_type: 消息类型 (file/image/audio/video)
            content: 消息内容
            sender: 发送者 open_id
            message_id: 消息 ID，用于下载资源
        """
        try:
            print(f"[Lark] 收到文件消息: type={msg_type}, receive_id={receive_id}, message_id={message_id}")

            # 提取文件 key（图片消息用 image_key，普通文件用 file_key）
            file_key = content.get("file_key", "") or content.get("image_key", "")
            if not file_key:
                print(f"[Lark] 文件消息缺少 file_key, content={content}")
                return

            # 下载文件到本地
            local_file_path = None
            if message_id and self._file_client:
                try:
                    file_bytes = self._file_client.download_message_resource(message_id, file_key, msg_type)
                    if file_bytes:
                        # 确定文件扩展名
                        ext = "bin"
                        if msg_type == "image":
                            # 尝试根据 image_key 判断类型，默认 png
                            ext = "png"
                        elif msg_type == "file":
                            ext = "bin"
                        elif msg_type == "audio":
                            ext = "mp3"
                        elif msg_type == "video":
                            ext = "mp4"

                        # 保存到 data/2222 目录
                        import uuid
                        file_dir = DATA_DIR / "2222"
                        file_dir.mkdir(exist_ok=True)
                        local_file_path = file_dir / f"{uuid.uuid4().hex}.{ext}"
                        local_file_path.write_bytes(file_bytes)
                        print(f"[Lark] 文件已保存: {local_file_path}")
                except Exception as e:
                    print(f"[Lark] 下载文件失败: {e}")

            # 构建文件描述
            if local_file_path and msg_type == "image":
                file_desc = f"[用户发送了图片，本地路径: {local_file_path}]"
            elif local_file_path:
                file_desc = f"[用户发送了 {msg_type} 文件，本地路径: {local_file_path}]"
            else:
                file_desc = f"[用户发送了 {msg_type} 文件，file_key={file_key}]"

            # 只传新消息，AgentRuntime 管理会话
            messages = [
                {"role": "system", "content": f"[用户信息] platform=lark, user_id={sender}"},
                {"role": "user", "content": file_desc}
            ]

            # 设置全局平台信息
            from core.tools import set_current_user
            set_current_user("lark", sender)

            # 流式处理响应
            full_response = ""
            thinking_content = []
            streaming_msg_id = None

            try:
                # 1. 先创建初始消息
                streaming_msg_id = await self._send_text(receive_id, receive_id_type, "正在处理文件...")

                print(f"[Lark] 开始调用 chat_handler, messages 数量={len(messages)}")

                # 2. 流式处理响应
                async for chunk in self.chat_handler(messages):
                    chunk_type = chunk.get("type")
                    if chunk_type == "delta":
                        delta = chunk.get("content", "")
                        full_response += delta
                        self._extract_thinking(delta, thinking_content)

                # 3. 发送结果
                final_display = self._remove_thinking_tags(full_response)
                result_card = self._build_result_card(
                    final_display if final_display else "文件已收到",
                    thinking_content,
                    None,
                    "green"
                )
                await self._send_card(receive_id, receive_id_type, result_card)

                # 删除中间消息
                if streaming_msg_id:
                    try:
                        from lark_oapi.api.im.v1 import DeleteMessageRequest
                        delete_request = DeleteMessageRequest.builder().message_id(streaming_msg_id).build()
                        self.client.im.v1.message.delete(delete_request)
                    except:
                        pass

            except Exception as e:
                print(f"[Lark] 处理文件消息异常: {e}")

            # AgentRuntime 已自动保存会话

        except Exception as e:
            print(f"[Lark] 处理文件消息失败: {e}")

    def _extract_thinking(self, text: str, thinking_content: list):
        """提取思考标签内容"""
        # 提取 <result>...</result>
        for match in re.finditer(r'<result>([\s\S]*?)</result>', text):
            content = match.group(1).strip()
            if content:
                thinking_content.append(content)
        # 提取 <thinking>...</thinking>
        for match in re.finditer(r'<thinking>([\s\S]*?)</thinking>', text):
            content = match.group(1).strip()
            if content:
                thinking_content.append(content)
        # 提取 <think>...</think> ( Anthropic 格式)
        for match in re.finditer(r'<think>([\s\S]*?)</think>', text):
            content = match.group(1).strip()
            if content:
                thinking_content.append(content)

    def _build_streaming_card(self, content: str, thinking: list, tool_name: str = None, header_color: str = "blue") -> dict:
        """构建流式输出卡片（简化版，兼容飞书）"""
        main_content = self._remove_thinking_tags(content)

        elements = []

        # 状态栏
        if tool_name:
            status_text = f"使用工具: {tool_name}"
        elif content:
            status_text = "生成回答中..."
        else:
            status_text = "正在思考..."
        elements.append({
            "tag": "div",
            "text": {
                "tag": "lark_md",
                "content": status_text
            }
        })

        # 主内容 - 限制在 2000 字符以内
        if main_content.strip():
            display_content = main_content[:2000]
            if len(main_content) > 2000:
                display_content += "\n\n(内容过长已截断)"
            elements.append({
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": display_content
                }
            })
        else:
            elements.append({
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "等待响应..."
                }
            })

        return {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": "AI 思考中"},
                "template": header_color
            },
            "elements": elements
        }

    def _build_result_card(self, content: str, thinking: list, tool_name: str = None, header_color: str = "green") -> dict:
        """构建结果卡片（简化版，兼容飞书）"""
        main_content = self._remove_thinking_tags(content)

        elements = []

        # 成功状态
        if tool_name:
            status_text = f"回答完成 (使用工具: {tool_name})"
        else:
            status_text = "回答完成"
        elements.append({
            "tag": "div",
            "text": {
                "tag": "lark_md",
                "content": status_text
            }
        })

        elements.append({"tag": "hr"})

        # 主内容 - 限制在 2500 字符以内
        if main_content.strip():
            display_content = main_content[:2500]
            if len(main_content) > 2500:
                display_content += "\n\n(内容过长已截断)"
            elements.append({
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": display_content
                }
            })

        return {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": "回答完成"},
                "template": header_color
            },
            "elements": elements
        }

    def _build_help_card(self) -> dict:
        """构建帮助卡片"""
        return {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": "1052 可用命令"},
                "template": "blue"
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": (
                            "**命令列表：**\n\n"
                            "/new — 新建对话，清空上下文\n"
                            "/compress — 压缩对话历史（AI 摘要）\n"
                            "/evolve — 开启进化模式（自主思考）\n"
                            "/stop — 停止进化模式\n"
                            "/help — 查看帮助\n\n"
                            "直接发送消息与我对话"
                        )
                    }
                }
            ]
        }

    def _remove_thinking_tags(self, text: str) -> str:
        """移除思考标签"""
        text = re.sub(r'<result>[\s\S]*?</result>', '', text)
        text = re.sub(r'<thinking>[\s\S]*?</thinking>', '', text)
        text = re.sub(r'<think>[\s\S]*?</think>', '', text)
        return text.strip()

    async def _send_card(self, receive_id: str, receive_id_type: str = "chat_id", card: dict = None) -> str:
        """发送卡片消息

        Args:
            receive_id: 接收方 ID
            receive_id_type: 接收ID类型 ("chat_id" 或 "open_id")
            card: 卡片内容 dict，如果为 None 则发送默认思考卡片
        """
        if card is None:
            card = self._build_streaming_card("💭 正在思考...", [], "blue")
        try:
            body = CreateMessageRequestBody.builder() \
                .receive_id(receive_id) \
                .msg_type("interactive") \
                .content(json.dumps(card, ensure_ascii=False)) \
                .build()

            request = CreateMessageRequest.builder() \
                .receive_id_type(receive_id_type) \
                .request_body(body) \
                .build()

            response = self.client.im.v1.message.create(request)

            if response.success():
                return response.data.message_id
            else:
                print(f"[Lark] 发送卡片失败: {response.msg}")
                return ""

        except Exception as e:
            print(f"[Lark] 发送卡片异常: {e}")
            return ""

    async def _update_card(self, message_id: str, card: dict):
        """更新卡片（通过删除+重建实现）"""
        if not message_id:
            return False

        try:
            # 1. 删除旧卡片
            from lark_oapi.api.im.v1 import DeleteMessageRequest
            delete_request = DeleteMessageRequest.builder() \
                .message_id(message_id) \
                .build()
            delete_response = self.client.im.v1.message.delete(delete_request)

            if not delete_response.success():
                print(f"[Lark] 删除旧卡片失败: {delete_response.msg}")
                return False

            return True

        except Exception as e:
            print(f"[Lark] 更新卡片异常: {e}")
            return False

    async def _update_text_message(self, message_id: str, text: str):
        """更新文本消息"""
        if not message_id:
            return

        try:
            if len(text) > 3000:
                text = text[:3000] + "\n...(内容已截断)"

            body = UpdateMessageRequestBody.builder() \
                .msg_type("text") \
                .content(json.dumps({"text": text}, ensure_ascii=False)) \
                .build()

            request = UpdateMessageRequest.builder() \
                .message_id(message_id) \
                .request_body(body) \
                .build()

            response = self.client.im.v1.message.update(request)

            if not response.success():
                print(f"[Lark] 更新文本失败: {response.msg}")

        except Exception as e:
            print(f"[Lark] 更新文本异常: {e}")

    async def _send_text(self, receive_id: str, receive_id_type: str, text: str) -> str:
        """发送纯文本消息

        Args:
            receive_id: 接收方 ID
            receive_id_type: 接收ID类型 ("chat_id" 或 "open_id")
            text: 文本内容
        """
        try:
            body = CreateMessageRequestBody.builder() \
                .receive_id(receive_id) \
                .msg_type("text") \
                .content(json.dumps({"text": text}, ensure_ascii=False)) \
                .build()

            request = CreateMessageRequest.builder() \
                .receive_id_type(receive_id_type) \
                .request_body(body) \
                .build()

            response = self.client.im.v1.message.create(request)

            if response.success():
                return response.data.message_id
            else:
                print(f"[Lark] 发送文本失败: {response.msg}")
                return ""

        except Exception as e:
            print(f"[Lark] 发送文本异常: {e}")
            return ""

    async def _send_file(self, receive_id: str, receive_id_type: str, file_path: str):
        """发送文件

        Args:
            receive_id: 接收方 ID
            receive_id_type: 接收ID类型 ("chat_id" 或 "open_id")
            file_path: 文件路径（来自工具返回的 [LARK_FILE:xxx] 格式）
        """
        if not file_path:
            return

        # 处理文件路径 - 来自 send_to_lark 工具的路径格式
        if file_path.startswith("/files/"):
            # 来自 URL 的文件路径: /files/xxx
            local_path = str(DATA_DIR / "1111" / file_path[8:])
        elif file_path.startswith("data/1111/"):
            # 来自 send_to_lark 工具的路径: data/1111/xxx
            # "data/1111/" 是 11 个字符，索引 11 及之后是文件名
            local_path = str(DATA_DIR / "1111" / file_path[11:])
        elif file_path.startswith("data/1111"):
            # 边缘情况: data/1111xxx (无斜杠)
            local_path = str(DATA_DIR / "1111" / file_path[10:])
        elif not os.path.isabs(file_path):
            # 其他相对路径
            local_path = str(DATA_DIR / "1111" / file_path)
        else:
            local_path = file_path

        local_path = os.path.normpath(local_path)

        print(f"[Lark] 准备发送文件: {local_path}")

        if not os.path.exists(local_path):
            print(f"[Lark] 文件不存在: {local_path}")
            return

        try:
            filename_lower = local_path.lower()

            if filename_lower.endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp')):
                await self._send_image(receive_id, local_path, receive_id_type)
            else:
                await self._send_document(receive_id, local_path, receive_id_type)

        except Exception as e:
            print(f"[Lark] 发送文件失败: {e}")

    async def _send_image(self, receive_id: str, image_path: str, receive_id_type: str = "chat_id"):
        """发送图片

        Args:
            receive_id: 接收方 ID (chat_id 或 open_id)
            image_path: 图片路径
            receive_id_type: 接收ID类型 ("chat_id" 或 "open_id")
        """
        if not self._file_client:
            print("[Lark] 文件客户端未初始化")
            return

        try:
            # 上传图片获取 image_key
            image_key = self._file_client.upload_image(image_path)
            print(f"[Lark] 图片上传成功: {image_key}")

            # 发送图片消息
            result = self._file_client.send_image_message(receive_id, receive_id_type, image_key)
            print(f"[Lark] 图片发送成功: {result.get('data', {}).get('message_id', '')}")

        except Exception as e:
            print(f"[Lark] 发送图片异常: {e}")

    async def _send_document(self, receive_id: str, file_path: str, receive_id_type: str = "chat_id"):
        """发送文件

        Args:
            receive_id: 接收方 ID (chat_id 或 open_id)
            file_path: 文件路径
            receive_id_type: 接收ID类型 ("chat_id" 或 "open_id")
        """
        if not self._file_client:
            print("[Lark] 文件客户端未初始化")
            return

        try:
            # 上传文件获取 file_key
            file_key = self._file_client.upload_file(file_path)
            print(f"[Lark] 文件上传成功: {file_key}")

            # 发送文件消息
            result = self._file_client.send_file_message(receive_id, receive_id_type, file_key)
            print(f"[Lark] 文件发送成功: {result.get('data', {}).get('message_id', '')}")

        except Exception as e:
            print(f"[Lark] 发送文件异常: {e}")

    async def _compress_context_task(self, user_id: str, receive_id: str, receive_id_type: str = "chat_id"):
        """后台压缩上下文任务（使用 AgentRuntime）"""
        try:
            await self._send_text(receive_id, receive_id_type,
                "🔄 **正在压缩上下文...**\n\n⏱️ 预计需要 1-2 分钟，请稍候..."
            )

            from core.agent_runtime import get_agent_runtime
            runtime = get_agent_runtime()
            result = await runtime.compact_session(platform="lark", user_id=user_id)

            original = result.get("original_count", 0)
            preserve = result.get("preserve_count", 0)

            if original == 0:
                await self._send_text(receive_id, receive_id_type, "📝 **没有消息可压缩**")
                return

            compress_ratio = int((1 - (preserve + 1) / original) * 100) if original > 0 else 0

            await self._send_text(receive_id, receive_id_type,
                "✅ **上下文压缩完成！**\n\n"
                f"📊 **压缩结果：**\n"
                f"• 原始消息数：{original} 条\n"
                f"• 压缩后：1 条摘要 + {preserve} 条最近对话\n"
                f"• 压缩比：约 {compress_ratio}%\n\n"
                "🔄 您可以继续对话，上下文已精简。"
            )

        except Exception as e:
            print(f"[Lark] 压缩上下文异常: {e}")
            await self._send_text(receive_id, receive_id_type, f"❌ **压缩失败**：{str(e)[:100]}")

