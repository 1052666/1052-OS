import os
import time
import subprocess
import pyautogui
from os import path
from functools import wraps
from .WechatTools import Tools
from .WinSettings import Systemsettings
from .WechatTools import match_duration,mouse
from .Errors import TimeNotCorrectError,NotFriendError
from .Uielements import Buttons,Main_window,Texts,Edits,SideBar
Buttons=Buttons()
Main_window=Main_window()
Texts=Texts()
Edits=Edits()
SideBar()
language=Tools.language_detector()
#pywechat内的ffmpeg.exe路径
module_dir=os.path.dirname(os.path.abspath(__file__))
ffmpeg_path=os.path.join(module_dir, 'ffmpeg', 'ffmpeg.exe')

def auto_reply_to_friend_decorator(duration:str,friend:str,search_pages:int=5,wechat_path:str=None,is_maximize:bool=True,close_wechat:bool=True):
    '''
    该函数为自动回复指定好友的修饰器\n
    Args:
        friend:好友或群聊备注
        duration:自动回复持续时长,格式:'s','min','h',单位:s/秒,min/分,h/小时
        search_pages:在会话列表中查询查找好友时滚动列表的次数,默认为5,一次可查询5-12人,当search_pages为0时,直接从顶部搜索栏搜索好友信息打开聊天界面\n
        wechat_path:微信的WeChat.exe文件地址,主要针对未登录情况而言,一般而言不需要传入该参数,因为pywechat会通过查询环境变量,注册表等一些方法\n
            尽可能地自动找到微信路径,然后实现无论PC微信是否启动都可以实现自动化操作,除非你的微信路径手动修改过,发生了变动的话可能需要\n
            传入该参数。最后,还是建议加入到环境变量里吧,这样方便一些。加入环境变量可调用set_wechat_as_environ_path函数\n
        is_maximize:微信界面是否全屏,默认全屏。
        close_wechat:任务结束后是否关闭微信,默认关闭
    Examples:
    ```
    from pywechat.utils import auto_reply_to_friend_decorator
    @auto_reply_to_friend_decorator(duration='10min',friend='好友')
    def reply_func(newMessage):
        if '在吗' in newMessage:
            return '你好,我不在'
        if '在干嘛?' in newMessage:
            return '在挂机'
        return '不再'
    reply_func()
    ```
    '''
    def decorator(reply_func):
        @wraps(reply_func)
        def wrapper():
            if not match_duration(duration):#不按照指定的时间格式输入,需要提前中断退出
                raise TimeNotCorrectError
            edit_area,main_window=Tools.open_dialog_window(friend=friend,wechat_path=wechat_path,is_maximize=is_maximize,search_pages=search_pages)
            voice_call_button=main_window.child_window(**Buttons.VoiceCallButton)
            video_call_button=main_window.child_window(**Buttons.VideoCallButton)
            if not voice_call_button.exists():
                #公众号没有语音聊天按钮
                main_window.close()
                raise NotFriendError(f'非正常好友,无法自动回复!')
            if not video_call_button.exists() and voice_call_button.exists():
                main_window.close()
                raise NotFriendError('auto_reply_to_friend只用来自动回复好友,如需自动回复群聊请使用auto_reply_to_group!')
            chatList=main_window.child_window(**Main_window.FriendChatList)#聊天界面内存储所有信息的容器
            initial_last_message=Tools.pull_latest_message(chatList)[0]#刚打开聊天界面时的最后一条消息的listitem   
            Systemsettings.open_listening_mode(full_volume=False)#开启监听模式,此时电脑只要不断电不会息屏 
            endtime_stamp=time.time()+match_duration(duration)  
            while time.time()<endtime_stamp:
                newMessage,who=Tools.pull_latest_message(chatList)
                #消息列表内的最后一条消息(listitem)不等于刚打开聊天界面时的最后一条消息(listitem)
                #并且最后一条消息的发送者是好友时自动回复
                #这里我们判断的是两条消息(listitem)是否相等,不是文本是否相等,要是文本相等的话,对方一直重复发送
                #刚打开聊天界面时的最后一条消息的话那就一直不回复了
                if newMessage!=initial_last_message and who==friend:
                    reply_content=reply_func(newMessage)
                    Systemsettings.copy_text_to_windowsclipboard(reply_content)
                    pyautogui.hotkey('ctrl','v',_pause=False)
                    pyautogui.hotkey('alt','s',_pause=False)
            Systemsettings.close_listening_mode()
            if close_wechat:
                main_window.close()
        return wrapper
    return decorator 

def auto_reply_to_group_decorator(duration:str,group_name:str,search_pages:int=5,at_only:bool=False,maxReply:int=3,at_other:bool=True,is_maximize:bool=True,close_wechat:bool=True):
    '''
    该函数为自动回复指定群聊的修饰器\n
    Args:
        friend:好友或群聊备注\n
        duration:自动回复持续时长,格式:'s','min','h',单位:s/秒,min/分,h/小时\n
        search_pages:在会话列表中查询查找好友时滚动列表的次数,默认为5,一次可查询5-12人,当search_pages为0时,直接从顶部搜索栏搜索好友信息打开聊天界面\n
        folder_path:存放聊天记录截屏图片的文件夹路径\n
        is_maximize:微信界面是否全屏,默认全屏。\n
        close_wechat:任务结束后是否关闭微信,默认关闭\n
    '''
    def decorator(reply_func):
        '''
        Args:
            reply_func:根据新消息设定回复逻辑的函数,返回值为待回复内容
        '''
        @wraps(reply_func)
        def wrapper():
            def at_others(who):
                edit_area.click_input()
                edit_area.type_keys(f'@{who}')
                pyautogui.press('enter',_pause=False)
            def send_message(newMessage,who,reply_func):
                if at_only:
                    if who!=myname and f'@{myalias}' in newMessage:#如果消息中有@我的字样,那么回复
                        if at_other:
                            at_others(who)
                        reply_content=reply_func(newMessage)
                        Systemsettings.copy_text_to_windowsclipboard(reply_content)
                        pyautogui.hotkey('ctrl','v',_pause=False)
                        pyautogui.hotkey('alt','s',_pause=False)
                    else:#消息中没有@我的字样不回复
                        pass
                if not at_only:#at_only设置为False时,只要有人发新消息就自动回复
                    if who!=myname:
                        if at_other:
                            at_others(who)
                        reply_content=reply_func(newMessage)
                        Systemsettings.copy_text_to_windowsclipboard(reply_content)
                        pyautogui.hotkey('ctrl','v',_pause=False)
                        pyautogui.hotkey('alt','s',_pause=False)
                    else:
                        pass
            if not match_duration(duration):#不按照指定的时间格式输入,需要提前中断退出
                raise TimeNotCorrectError
            #打开好友的对话框,返回值为编辑消息框和主界面
            Systemsettings.set_english_input()
            edit_area,main_window=Tools.open_dialog_window(friend=group_name,is_maximize=is_maximize,search_pages=search_pages)
            myname=main_window.child_window(**Buttons.MySelfButton).window_text()#我的昵称
            chat_history_button=main_window.child_window(**Buttons.ChatHistoryButton)
            #需要判断一下是不是公众号
            if not chat_history_button.exists():
                #公众号没有语音聊天按钮
                main_window.close()
                raise NotFriendError(f'非正常群聊,无法自动回复!')
            #####################################################################################
            #打开群聊右侧的设置界面,看一看我的群昵称是什么,这样是为了判断我是否被@
            ChatMessage=main_window.child_window(**Buttons.ChatMessageButton)
            ChatMessage.click_input()
            group_settings_window=main_window.child_window(**Main_window.GroupSettingsWindow)
            group_settings_window.child_window(**Texts.GroupNameText).click_input()
            group_settings_window.child_window(**Buttons.MyAliasInGroupButton).click_input() 
            change_my_alias_edit=group_settings_window.child_window(**Edits.EditWnd)
            change_my_alias_edit.click_input()
            myalias=change_my_alias_edit.window_text()#我的群昵称
            ########################################################################
            chatList=main_window.child_window(**Main_window.FriendChatList)#聊天界面内存储所有信息的容器
            x,y=chatList.rectangle().left+8,(main_window.rectangle().top+main_window.rectangle().bottom)//2#
            mouse.click(coords=(x,y))
            responsed=[]
            initialMessages=Tools.pull_messages(friend=group_name,number=maxReply,search_pages=search_pages,is_maximize=is_maximize,close_wechat=False,parse=False)
            responsed.extend(initialMessages) 
            Systemsettings.open_listening_mode(full_volume=False)#开启监听模式,此时电脑只要不断电不会息屏 
            end_timestamp=time.time()+match_duration(duration)#根据秒数计算截止时间  
            while time.time()<end_timestamp:
                newMessages=Tools.pull_messages(friend=group_name,number=maxReply,search_pages=search_pages,is_maximize=is_maximize,close_wechat=False,parse=False)
                filtered_newMessages=[newMessage for newMessage in newMessages if newMessage not in responsed]
                for newMessage in filtered_newMessages:
                    message_sender,message_content,message_type=Tools.parse_message_content(ListItem=newMessage,friendtype='群聊')
                    send_message(message_content,message_sender,reply_func)
                    responsed.append(newMessage)
            if close_wechat:
                main_window.close()
        return wrapper
    return decorator

def dat_to_video(dat_file:path,output_folder:path,filename:str,transcode:bool=True):
    '''
    该函数用来将微信视频类型的dat文件转换为mp4类型,需要注意的是微信部分视频\n
    编码格式为HEVC,如果有HEVC播放器可以直接播放,否则,需要转换编码方式
    Args:
        dat_file:微信dat类型文件路径
        output_folder:导出文件夹
        filename:文件名,不需要包含.mp4
        transcode:是否使用ffmpeg转换编码格式,不转换无法直接播放,默认转换
    '''
    filename=filename.replace('.mp4','')
    with open(dat_file, 'rb') as f:
        encrypted_data=f.read()
    detected_format=None
    mp4_headers={
    b'\x00\x00\x00\x1cftypisom',#实测,视频文件的话这个格式是最常见的
    b'\x00\x00\x00\x1cftypmp42',#iPhone12pro以下的手机拍摄视频格式是这个
    b'\x00\x00\x00\x1cftypmp41', 
    b'\x00\x00\x00\x20ftypisom',
    b'\x00\x00\x00\x20ftpypisom'
    }
    for header in mp4_headers:
        if encrypted_data.startswith(header):
            detected_format='.mp4'
            decrypted_data=encrypted_data
            break
    if detected_format=='.mp4':
        output_file=os.path.join(output_folder,filename)+detected_format
        if transcode:
            ffmpeg_command=[ffmpeg_path,
            '-i', 'pipe:0',          
            '-c:v', 'libx264',      #视频编码器（H.264）
            '-crf', '18',         #画质控制（18-28，值越小画质越高）
            '-preset','fast',       #编码速度（fast, medium, slow）
            '-c:a', 'copy',        #音频直接复制（不重新编码）
            '-y',             #覆盖输出文件
            output_file]
            subprocess.Popen(ffmpeg_command)
            process=subprocess.Popen(ffmpeg_command, stdin=subprocess.PIPE)
            process.communicate(input=decrypted_data)
        else:
            with open(output_file, 'wb') as f:
                f.write(decrypted_data)
    else:
        print(f'该dat文件不是视频,可能是图片,如需解密并转换为图片可调用decrytpt_dat或decrypt_image_dat函数!')

def decrypt_dat(dat_file:path,output_folder:path,filename:str,transcode:bool=True):
    '''
    解密微信.dat类型文件并保存为图片或mp4,需要注意的是微信部分视频\n
    编码格式为HEVC,如果有HEVC播放器可以直接播放,否则,需要转换编码方式
    Args:
        dat_file:微信.dat类型文件路径
        output_folder:输出图片或视频所在文件夹
        filename:文件名称,不需要包含后缀名
        transcode:是否使用ffmpeg转换编码格式,不转换无法直接播放,默认转换
    '''
    #微信图片是被简单的异或加密过
    #视频mp4文件是没有加密的，直接转换为mp4后使用ffmpeg转换一下格式即可使用
    def xor_decrypt(encrypted_data:bytes)->bytes:
        possible_keys=[]
        for header in headers:
            key=bytes([encrypted_data[i]^header[i] for i in range(len(header))])
            #密钥是单字节
            if all(k==key[0] for k in key):
                possible_keys.append(key[0])
        key=possible_keys[0]
        decrypted_data=bytes([b^key for b in encrypted_data])
        return decrypted_data
    
    detected_format='.mp4'
    #微信常见的图片与视频格式文件头
    headers = {
    b'\xFF\xD8\xFF':'.jpg',
    b'\x89\x50\x4E\x47':'.png',
    b'\x47\x49\x46\x38':'.gif',
    b'\x42\x4D': '.bmp',
    b'\x49\x49\x2A\x00':'.tif',
    b'\x4D\x4D\x00\x2A':'.tif',
    b'\x00\x00\x00\x1cftypisom':'.mp4',#实测,视频文件的话这个格式是最常见的
    b'\x00\x00\x00\x1cftypmp42':'.mp4',#iPhone12pro以下的手机拍摄视频格式是这个
    b'\x00\x00\x00\x1cftypmp41':'.mp4', 
    b'\x00\x00\x00\x20ftypisom':'.mp4',
    b'\x00\x00\x00\x20ftpypisom':'.mp4'
    }
    with open(dat_file, 'rb') as f:
        encrypted_data=f.read()
    #先不解密看一下是不是mp4类型文件即是否按照所给的header开头
    for header in headers.keys():
        if encrypted_data.startswith(header):
            detected_format='.mp4'
            decrypted_data=encrypted_data
            break
    #如果不是,那么就是图片，异或解密后再根据header确定具体类型
    if not detected_format:
        decrypted_data=xor_decrypt(encrypted_data)
        for header, fmt in headers.items():
            if decrypted_data.startswith(header):
                detected_format=fmt
                break
    output_file=os.path.join(output_folder,filename)+detected_format
    if detected_format=='.mp4' and transcode:
        ffmpeg_command=[ffmpeg_path,
        '-i', 'pipe:0',          
        '-c:v', 'libx264',      #视频编码器（H.264）
        '-crf', '18',         #画质控制（18-28，值越小画质越高）
        '-preset','fast',       #编码速度（fast, medium, slow）
        '-c:a', 'copy',        #音频直接复制（不重新编码）
        '-y',             #覆盖输出文件
        output_file]
        subprocess.Popen(ffmpeg_command)
        process=subprocess.Popen(ffmpeg_command, stdin=subprocess.PIPE)
        process.communicate(input=encrypted_data)
    else:
        with open(output_file, 'wb') as f:
            f.write(decrypted_data)

def decrypt_image_dat(dat_file:path,output_folder:path,filename:str):
    '''
    解密微信.dat类型文件并保存为png格式图片
    Args:
        dat_file:微信.dat类型文件路径
        output_folder:输出图片的文件夹
        filename:文件名称,不需要包含后缀名.png
    '''
    filename=filename.replace('.png','')
    image_headers={
    b'\xFF\xD8\xFF',
    b'\x89\x50\x4E\x47',
    b'\x47\x49\x46\x38',
    b'\x42\x4D',
    b'\x49\x49\x2A\x00',
    b'\x4D\x4D\x00\x2A',
    }
    with open(dat_file, 'rb') as f:
        encrypted_data=f.read()
    possible_keys=[]
    for header in image_headers:
        key=bytes([encrypted_data[i]^header[i] for i in range(len(header))])
        #密钥是单字节
        if all(k==key[0] for k in key):
            possible_keys.append(key[0])
    if possible_keys:
        key=possible_keys[0]
        decrypted_data=bytes([b^key for b in encrypted_data])
        output_file=os.path.join(output_folder,filename)+'.png'#统一为png格式
        with open(output_file, 'wb') as f:
            f.write(decrypted_data)
    else:
        print(f'该dat文件不是图片,可能是视频,如需转换为视频可调用decrytpt_dat或dat_to_video函数!')

def transcode(mp4_path:str,folder:str,filename:str):
    '''
    该函数通过调用pywechat内的ffmpeg.exe执行转换编码指令\n
    来将直接修改dat文件后缀为.mp4文件的内容转为H264编码使其可播放
    '''
    output_file=os.path.join(folder,filename)
    ffmpeg_command=[ffmpeg_path,
    '-i', f'{mp4_path}',          
    '-c:v', 'libx264',     #视频编码器(H.264）
    '-crf', '18',       #画质控制(18-28,值越小画质越高）
    '-preset','fast',      #编码速度(fast,medium,slow）
    '-c:a', 'copy',       #音频直接复制(不重新编码)
    '-y',            #覆盖输出文件
    output_file]
    subprocess.Popen(ffmpeg_command)