
'''
pywechat
========
一个windows系统下的PC微信自动化工具\n
你可前往 'https://github.com/Hello-Mr-Crab/pywechat' 获取操作文档\n
模块:\n
---------
WechatTools:该模块中封装了一系列关于PC微信的工具,主要包括:检测微信运行状态;\n
打开微信主界面内绝大多数界面;打开指定公众号与微信小程序以及视频号\n
---------------
WechatAuto:pywechat的主要模块,其内部包含了:\n
    Messages:5种类型的发送消息功能包括:单人单条,单人多条,多人单条,多人多条,转发消息:多人同一条消息\n
    Files:5种类型的发送文件功能包括:单人单个,单人多个,多人单个,多人多个,转发文件:多人同一个文件\n
    FriendSettings:涵盖了PC微信针对某个好友的全部操作\n
    GroupSettings:涵盖了PC微信针对某个群聊的全部操作\n
    Contacts:获取微信所有好友详细信息(昵称,备注,地区，标签,个性签名,共同群聊,微信号,来源),\n
    获取微信所有好友信息(昵称,备注,微信号),获取微信所有好友名称(昵称,备注),获取所有企业号微信信息(好友名称,企业名称)
    获取群聊信息(群聊名称与人数),获取群聊内所有群成员的群昵称\n
    Call:给某个好友打视频或语音电话,在群聊内发起语音电话\n
    AutoReply:包含对指定好友的AI自动回复消息,类似QQ的自动回复指定消息,以及自动接听语音或视频电话\n
    WeChatSettings:用于修改PC微信设置\n
---------------------
Winsettings:一些修改windows系统设置的方法\n
----------------------
Uielements:微信主界面内UI的封装\n
-----------------
Clocks:用于实现pywechat内所有方法定时操作的模块\n
-----------------
Warnings:一些可能触发的警告\n
-----------------------
支持版本
---------------
OS-Version:window10,windows11\n
----------------------------
Python-version:3.x,\tWechatVersion:3.9.12.5x\n
----------------------------------
Have fun in WechatAutomation (＾＿－)
====
'''
from.WechatAuto import *
from.WechatTools import *
from.WinSettings import *
from.Clock import *
#Author:Hello-Mr-Crab
#version:1.9.6

