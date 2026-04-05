"""
demo.py - 微信收发消息使用示例

运行前请确保:
1. Windows 10/11 系统
2. 微信 PC 版已登录 (3.9+ 或 4.1+)
3. 已安装依赖: pip install -r requirements.txt
"""

from wechat_msg import (
    send_message,
    send_message_to_many,
    send_file,
    get_chat_history,
    check_new_messages,
    listen_on_chat,
    auto_reply,
)


def demo_send_message():
    """示例1: 发送消息给单个好友"""
    send_message(
        friend='文件传输助手',
        messages=['你好，这是通过 pywechat 发送的消息', '自动发送测试'],
    )
    print('消息发送完成')


def demo_send_message_to_many():
    """示例2: 批量给多个好友发送消息"""
    send_message_to_many(
        friends=['文件传输助手', '张三'],
        messages_list=[
            ['批量消息测试1'],
            ['批量消息测试2'],
        ],
    )
    print('批量消息发送完成')


def demo_send_file():
    """示例3: 发送文件给好友"""
    send_file(
        friend='文件传输助手',
        files=[r'C:\Users\test\document.txt'],
        messages=['请查收文件'],
    )
    print('文件发送完成')


def demo_get_chat_history():
    """示例4: 获取聊天记录"""
    messages = get_chat_history(friend='文件传输助手', number=10)
    print('=== 聊天记录 ===')
    for i, msg in enumerate(messages, 1):
        print(f'{i}. {msg}')


def demo_check_new_messages():
    """示例5: 检查新消息"""
    new_msgs = check_new_messages()
    print('=== 新消息 ===')
    if not new_msgs:
        print('暂无新消息')
    else:
        for friend, msgs in new_msgs.items():
            print(f'{friend}: {msgs}')


def demo_listen_on_chat():
    """示例6: 监听聊天窗口 (监听2分钟)"""
    print('开始监听文件传输助手的消息...')
    msgs = listen_on_chat(friend='文件传输助手', duration='2min')
    print('=== 监听到的消息 ===')
    for msg in msgs:
        print(msg)


def demo_auto_reply():
    """示例7: 自动回复"""
    def my_reply(new_message):
        if '你好' in new_message:
            return '你好，有什么可以帮你的吗？'
        if '在吗' in new_message:
            return '在的，请说'
        if '谢谢' in new_message:
            return '不客气！'
        return '收到，稍后回复你'

    print('开始自动回复 (持续5分钟)...')
    auto_reply(friend='文件传输助手', duration='5min', reply_func=my_reply)


if __name__ == '__main__':
    print('微信收发消息示例')
    print('=' * 40)
    print('请取消注释你想运行的示例函数')

    # 取消注释下面的函数来运行对应示例
    # demo_send_message()
    # demo_send_message_to_many()
    # demo_send_file()
    # demo_get_chat_history()
    # demo_check_new_messages()
    # demo_listen_on_chat()
    # demo_auto_reply()
