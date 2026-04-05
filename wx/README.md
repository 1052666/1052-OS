# wx/ - 微信自动化模块

基于 [pywechat](https://github.com/Hello-Mr-Crab/pywechat) 的 Windows PC 微信收发消息封装，为 1052 AI 助手提供微信能力。

## 模块定位

```
1052 AI 助手
├── im_integration/wechat_bot.py   ← 微信机器人（上层，对接 AI 引擎）
└── wx/                            ← 微信自动化底层（本模块）
    ├── wechat_msg.py                  统一 API 接口
    ├── pyweixin/                      微信 4.1+ 引擎
    └── pywechat/                      微信 3.9+ 引擎
```

- `wechat_bot.py` 调用本模块的 `wechat_msg.py` 实现消息监听、AI 回复
- 本模块也可以**独立使用**，不依赖 1052 其他部分

## 环境要求

| 项目 | 版本 |
|------|------|
| 操作系统 | Windows 10 / Windows 11 |
| Python | 3.9+ |
| 微信 PC 版 | 3.9+ 或 4.1+ |

依赖已包含在根目录 `requirements.txt` 中，无需单独安装。

## 目录结构

```
wx/
├── wechat_msg.py            # 统一接口（你只需要导入这个文件）
├── demo.py                  # 独立使用示例
├── requirements.txt         # 独立运行时的依赖（可选）
├── README.md                # 本文件
├── pyweixin/                # 微信 4.1+ 底层模块
│   ├── __init__.py
│   ├── Config.py                全局配置
│   ├── WeChatAuto.py            主模块（消息/文件/监听/自动回复）
│   ├── WeChatTools.py           工具（打开窗口/导航/查找好友）
│   ├── Uielements.py            UI 控件定义
│   ├── WinSettings.py           系统设置（剪贴板/音量/息屏）
│   ├── utils.py                 工具函数
│   ├── Errors.py
│   └── Warnings.py
└── pywechat/                # 微信 3.9+ 底层模块
    ├── __init__.py
    ├── WechatAuto.py
    ├── WechatTools.py
    ├── Uielements.py
    ├── WinSettings.py
    ├── utils.py
    ├── Clock.py
    ├── Errors.py
    └── Warnings.py
```

## 版本自动检测

`wechat_msg.py` 通过进程检测自动选择引擎：
- 检测到 `WeChatAppex` 进程 → 微信 4.1+ → 使用 `pyweixin`
- 未检测到 → 微信 3.9+ → 使用 `pywechat`

无需手动选择。

## API 接口

所有函数都在 `wechat_msg.py` 中，使用方式：

```python
# 在 1052 项目内（wechat_bot.py 的方式）
import sys
sys.path.insert(0, 'wx')
from wechat_msg import send_message

# 独立使用
from wechat_msg import send_message
```

### send_message(friend, messages)

发送消息给好友/群聊。

```python
send_message('张三', ['你好', '这是自动发送的消息'])
send_message('工作群', ['通知：今天开会'])
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `friend` | str | 好友备注或群聊名称，必须与微信显示一致 |
| `messages` | list[str] | 消息列表，按顺序逐条发送 |
| `close_wechat` | bool | 完成后是否关闭微信，默认 False |

### send_message_to_many(friends, messages_list)

批量给多个好友发消息。

```python
send_message_to_many(
    friends=['张三', '李四'],
    messages_list=[['你好张三'], ['你好李四']],
)
```

`friends` 和 `messages_list` 长度必须一致，顺序一一对应。

### send_file(friend, files)

发送文件，可附带消息。

```python
# 只发文件
send_file('文件传输助手', files=[r'C:\report.xlsx'])

# 文件 + 消息
send_file('张三', files=[r'C:\doc.pdf'], messages=['请查收'])

# 先发消息再发文件
send_file('张三', files=[r'C:\doc.pdf'], messages=['文件来了'], messages_first=True)
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `friend` | str | 好友名称 |
| `files` | list[str] | 文件绝对路径列表 |
| `messages` | list[str] | 附带消息（可选） |
| `messages_first` | bool | 先发消息再发文件，默认 False |
| `close_wechat` | bool | 完成后是否关闭微信 |

### get_chat_history(friend, number)

获取聊天记录。

```python
msgs = get_chat_history('张三', number=20)
for msg in msgs:
    print(msg)
```

返回消息文本列表，按时间从早到晚排列。

### check_new_messages()

检查会话列表中所有新消息。

```python
new_msgs = check_new_messages()
# 返回: {'张三': ['消息1', '消息2'], '工作群': ['消息3']}
```

### listen_on_chat(friend, duration)

监听指定聊天窗口，在时长内收集所有新消息。

```python
msgs = listen_on_chat('张三', duration='2min')
```

时长格式：`30s` / `5min` / `1h`

### auto_reply(friend, duration, reply_func)

自动回复。

```python
def my_reply(new_message):
    if '你好' in new_message:
        return '你好，有什么可以帮你的？'
    return '收到'

auto_reply('张三', '10min', my_reply)
```

`reply_func` 必须始终返回字符串，不能返回 None。

## 在 1052 中的集成

`im_integration/wechat_bot.py` 的 `WeChatBot` 类通过本模块实现：

1. **主窗口监听** — 持续监听 `primary_chat` 指定的聊天
2. **群聊监听** — 动态添加/移除群聊监听，群内需 @机器人 才响应
3. **AI 回复** — 收到消息后调用 `chat_handler` 流式生成回复
4. **文件发送** — AI 生成文件后自动发送到聊天
5. **打断恢复** — 新消息到来时打断旧的流式输出，保留上下文

配置方式（`data/config.json`）：

```json
{
  "im": {
    "wechat": {
      "enabled": true,
      "primary_chat": "文件传输助手",
      "bot_name": "",
      "mention_pattern": ""
    }
  }
}
```

**配置字段说明：**

| 字段 | 说明 |
|------|------|
| `primary_chat` | 主监听窗口名称（好友备注或群聊名称），机器人会持续监听这个窗口的消息 |
| `bot_name` | 当前登录微信的昵称。用于群聊中识别 @你的消息。**留空会自动检测**，检测失败则需要手动填写 |
| `mention_pattern` | 额外的 @匹配正则（可选）。比如 `@1052|@机器人` 会额外匹配这些 @方式。`bot_name` 的 @会自动加入，一般不需要填 |

**@识别逻辑：**
1. 启动时自动调用 `check_my_info()` 检测当前微信昵称
2. 检测成功：自动用 `@昵称` 匹配群聊 @消息
3. 检测失败：需要手动在 `bot_name` 填入你的微信昵称
4. `mention_pattern` 用于添加额外的触发词（如 `@机器人`）

## 注意事项

1. **单线程** — 微信不支持多线程操作，`wechat_bot.py` 用 `asyncio.to_thread` 隔离
2. **微信必须已登录** — PC 微信在线才能操作
3. **好友名称精确匹配** — 必须与微信显示的备注/昵称完全一致
4. **2000 字限制** — 超过自动转 txt 文件
5. **不要遮挡窗口** — 自动化期间不要手动操作微信窗口
6. **bot_name** — 群聊 @识别依赖此字段，自动检测失败时务必手动填写

## 常见问题

**Q: 微信 4.1 打开但操作无反应？**
A: 需要先开启一次 Windows 讲述人模式（Win+Ctrl+Enter），等 5 分钟后关闭，之后微信 UI 控件可被正常访问。

**Q: 发消息报 NotFriendError？**
A: 好友名称不对，检查是否和微信里显示的完全一致。

**Q: 独立使用怎么装依赖？**
A: `pip install -r requirements.txt`（wx 目录下有独立的 requirements.txt）。
