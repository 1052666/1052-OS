"""
wechat_msg.py - 微信收发消息封装模块
基于 pyweixin (微信4.1+) 和 pywechat (微信3.9+) 实现消息的发送与接收

功能:
    - 发送消息给单个好友/群聊
    - 批量发送消息给多个好友
    - 发送文件给好友
    - 获取聊天记录
    - 监听新消息
    - 自动回复
"""

import sys
import os

# 将当前目录(1052)加入 sys.path，确保能导入本目录下的 pyweixin / pywechat
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)


# ============================================================
#  微信版本自动检测
# ============================================================
def detect_wechat_version():
    """
    通过检测 WeChatAppex 进程来判断微信版本
    返回 '4.x' 或 '3.x'
    """
    try:
        import psutil
        for proc in psutil.process_iter(['name']):
            if proc.info['name'] and 'wechatappex' in proc.info['name'].lower():
                return '4.x'
    except Exception:
        pass
    return '3.x'


def get_engine():
    """
    根据微信版本返回对应的引擎模块
    返回: pyweixin 模块 (4.x) 或 pywechat 模块 (3.x)
    """
    version = detect_wechat_version()
    if version == '4.x':
        import pyweixin
        return pyweixin, version
    else:
        import pywechat
        return pywechat, version


# ============================================================
#  发送消息
# ============================================================
def send_message(friend: str, messages: list[str], close_wechat: bool = False):
    """
    发送消息给单个好友或群聊

    Args:
        friend: 好友备注或群聊名称
        messages: 消息列表, 如 ['你好', '测试消息']
        close_wechat: 完成后是否关闭微信窗口, 默认 False

    Examples:
        >>> send_message('文件传输助手', ['你好', '这是测试'])
    """
    engine, version = get_engine()

    if version == '4.x':
        from pyweixin.WeChatAuto import Messages
        from pyweixin.Config import GlobalConfig
        GlobalConfig.close_weixin = close_wechat
        Messages.send_messages_to_friend(
            friend=friend,
            messages=messages,
            close_weixin=close_wechat,
        )
    else:
        from pywechat.WechatAuto import Messages
        Messages.send_messages_to_friend(
            friend=friend,
            messages=messages,
            close_wechat=close_wechat,
        )


def send_message_to_many(friends: list[str], messages_list: list[list[str]], close_wechat: bool = False):
    """
    批量给多个好友发送消息

    Args:
        friends: 好友名称列表, 如 ['张三', '李四']
        messages_list: 每个好友对应的消息列表, 如 [['你好'], ['在吗']]
        close_wechat: 完成后是否关闭微信窗口

    Examples:
        >>> send_message_to_many(
        ...     friends=['文件传输助手', '张三'],
        ...     messages_list=[['测试1'], ['测试2']]
        ... )
    """
    engine, version = get_engine()

    if version == '4.x':
        from pyweixin.WeChatAuto import Messages
        Messages.send_messages_to_friends(
            friends=friends,
            messages=messages_list,
            close_weixin=close_wechat,
        )
    else:
        from pywechat.WechatAuto import Messages
        Messages.send_messages_to_friends(
            friends=friends,
            messages_list=messages_list,
            close_wechat=close_wechat,
        )


# ============================================================
#  发送文件
# ============================================================
def send_file(friend: str, files: list[str],
              messages: list[str] = None,
              messages_first: bool = False,
              close_wechat: bool = False):
    """
    发送文件给好友, 可附带消息

    Args:
        friend: 好友备注或群聊名称
        files: 文件路径列表
        messages: 附带发送的消息列表 (可选)
        messages_first: 是否先发消息再发文件, 默认先发文件
        close_wechat: 完成后是否关闭微信窗口

    Examples:
        >>> send_file('文件传输助手', files=[r'C:\\test.txt'])
        >>> send_file('张三', files=[r'C:\\doc.pdf'], messages=['请查收文件'])
    """
    engine, version = get_engine()

    if version == '4.x':
        from pyweixin.WeChatAuto import Files
        if messages:
            Files.send_files_to_friend(
                friend=friend,
                files=files,
                with_messages=True,
                messages=messages,
                messages_first=messages_first,
                close_weixin=close_wechat,
            )
        else:
            Files.send_files_to_friend(
                friend=friend,
                files=files,
                close_weixin=close_wechat,
            )
    else:
        from pywechat.WechatAuto import Files
        if messages:
            Files.send_files_to_friend(
                friend=friend,
                folder_path=files[0] if len(files) == 1 else None,
                with_messages=True,
                messages=messages,
                messages_first=messages_first,
                close_wechat=close_wechat,
            )
        else:
            Files.send_files_to_friend(
                friend=friend,
                folder_path=files[0] if len(files) == 1 else None,
                close_wechat=close_wechat,
            )


# ============================================================
#  接收/获取消息
# ============================================================
def get_chat_history(friend: str, number: int = 20, close_wechat: bool = False):
    """
    获取与好友的聊天记录

    Args:
        friend: 好友备注或群聊名称
        number: 获取的消息条数
        close_wechat: 完成后是否关闭微信窗口

    Returns:
        messages: 消息列表 (从早到晚)

    Examples:
        >>> msgs = get_chat_history('文件传输助手', number=10)
        >>> for msg in msgs:
        ...     print(msg)
    """
    engine, version = get_engine()

    if version == '4.x':
        from pyweixin.WeChatAuto import Messages
        return Messages.pull_messages(
            friend=friend,
            number=number,
            close_weixin=close_wechat,
        )
    else:
        from pywechat.WechatAuto import Messages
        return Messages.pull_messages(
            friend=friend,
            number=number,
            close_wechat=close_wechat,
        )


def check_new_messages(close_wechat: bool = False):
    """
    检查会话列表中所有新消息

    Returns:
        new_messages: dict, {好友名称: 消息内容列表}

    Examples:
        >>> new_msgs = check_new_messages()
        >>> for friend, msgs in new_msgs.items():
        ...     print(f'{friend}: {msgs}')
    """
    engine, version = get_engine()

    if version == '4.x':
        from pyweixin.WeChatAuto import Monitor
        return Monitor.check_new_messages(close_weixin=close_wechat)
    else:
        from pywechat.WechatAuto import Messages
        return Messages.check_new_message(close_wechat=close_wechat)


def listen_on_chat(friend: str, duration: str = '1min', close_wechat: bool = False):
    """
    监听指定好友的聊天窗口新消息

    Args:
        friend: 好友备注或群聊名称
        duration: 监听时长, 如 '30s', '5min', '1h'
        close_wechat: 完成后是否关闭微信窗口

    Returns:
        new_messages: 新消息文本列表

    Examples:
        >>> msgs = listen_on_chat('文件传输助手', duration='2min')
        >>> print(msgs)
    """
    engine, version = get_engine()

    if version == '4.x':
        from pyweixin.WeChatTools import Navigator
        from pyweixin.WeChatAuto import Monitor
        dialog_window = Navigator.open_seperate_dialog_window(
            friend=friend,
            window_minimize=True,
            close_weixin=close_wechat,
        )
        return Monitor.listen_on_chat(dialog_window, duration)
    else:
        from pywechat import listen_on_chat as _listen
        return _listen(friend=friend, duration=duration, close_wechat=close_wechat)


# ============================================================
#  自动回复
# ================================================= -*-
def auto_reply(friend: str, duration: str, reply_func, close_wechat: bool = False):
    """
    自动回复指定好友消息 (使用自定义回复函数)

    Args:
        friend: 好友备注
        duration: 自动回复持续时间, 如 '5min', '1h'
        reply_func: 回复函数, 接收 newMessage 参数, 返回回复内容字符串
        close_wechat: 完成后是否关闭微信窗口

    Examples:
        >>> def my_reply(new_message):
        ...     if '你好' in new_message:
        ...         return '你好，有什么可以帮你的吗？'
        ...     return '收到'
        >>> auto_reply('张三', '10min', my_reply)
    """
    engine, version = get_engine()

    if version == '4.x':
        from pyweixin.utils import auto_reply_to_friend_decorator
        decorated = auto_reply_to_friend_decorator(
            duration=duration,
            friend=friend,
            close_weixin=close_wechat,
        )(reply_func)
        decorated()
    else:
        from pywechat.utils import auto_reply_to_friend_decorator
        decorated = auto_reply_to_friend_decorator(
            duration=duration,
            friend=friend,
            close_wechat=close_wechat,
        )(reply_func)
        decorated()
