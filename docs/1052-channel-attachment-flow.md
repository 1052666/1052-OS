# 1052 三端附件流转说明

## 目标

网页端、微信通道、飞书通道的附件需要做到两件事：

- 入站时，Agent 不只看到文件名或 HTTP 相对链接，还能看到本地落盘路径；文本类文件会内联内容预览。
- 出站时，Agent 或用户可以引用 `/api/...` 链接、`file://...` 链接，或 `本地路径：C:\...`，系统会解析成真实文件并发送到微信或飞书。

## 入站格式

统一由 `backend/src/modules/agent/agent.attachment-context.ts` 生成附件上下文 Markdown：

````md
[微信文件：1052.TXT](/api/channels/wechat/media/inbound/2026-04/example.txt)

- 文件名：1052.TXT
- 类型：text/plain
- 大小：668 bytes
- 本地路径：C:\Users\...\data\channels\wechat\media\inbound\2026-04\example.txt

文件内容：
```text
...
```
````

文本类文件最多内联前 12000 字符，避免大文件把聊天上下文撑爆。

## 出站解析

微信和飞书出站链路会识别这些引用形式：

- `/api/agent/uploads/...`
- `/api/channels/wechat/media/...`
- `/api/channels/feishu/media/...`
- `/api/generated-images/...`
- `file:///C:/...`
- `本地路径：C:\...`
- 独立一行的 `C:\...`

解析成功后，文本仍按通道文本消息发送，文件会作为媒体或普通文件继续发送。

## 相关文件

- `backend/src/modules/agent/agent.attachment-context.ts`
- `backend/src/modules/agent/agent.upload.service.ts`
- `backend/src/modules/channels/wechat/wechat.media.ts`
- `backend/src/modules/channels/feishu/feishu.media.ts`
- `frontend/src/pages/Chat.tsx`
