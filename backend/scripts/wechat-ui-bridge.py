import json
import os
import re
import sys
import traceback


def write_json(payload):
    print(json.dumps(payload, ensure_ascii=False))


def fail(message, detail=None):
    payload = {"ok": False, "error": str(message)}
    if detail:
        payload["detail"] = str(detail)
    write_json(payload)
    sys.exit(1)


def load_args():
    if len(sys.argv) < 3:
        fail("Usage: wechat-ui-bridge.py <command> <json-args>")
    command = sys.argv[1]
    try:
        args = json.loads(sys.argv[2])
    except Exception as exc:
        fail("Invalid JSON args", exc)
    if not isinstance(args, dict):
        fail("Args must be a JSON object")
    return command, args


def configure_import_path():
    root = os.environ.get("PYWECHAT_ROOT", "").strip()
    if not root:
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        root = os.path.join(project_root, "vendor", "pywechat-windows-ui-auto-main")
    if not os.path.isdir(root):
        fail("PYWECHAT_ROOT does not exist", root)
    if root not in sys.path:
        sys.path.insert(0, root)
    return root


def normalize_text(value, field):
    if not isinstance(value, str) or not value.strip():
        fail(f"{field} is required")
    return value.strip()


def normalize_text_list(value):
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if isinstance(item, str) and item.strip():
            result.append(item.strip())
    return result


def unique_texts(values):
    result = []
    for value in values or []:
        text = str(value or "").strip()
        if text and text not in result:
            result.append(text)
    return result


def filter_messages_by_chat(messages_by_chat, chat_names):
    if not chat_names:
        return messages_by_chat or {}
    allowed = set(chat_names)
    return {
        chat: messages
        for chat, messages in (messages_by_chat or {}).items()
        if chat in allowed
    }


def is_timestamp_text(value):
    text = str(value or "").strip()
    return bool(re.search(r"(\d{1,2}:\d{2}|\d{4}.+\d{1,2}.+\d{1,2}.+|昨天|星期|周[一二三四五六日天])", text))


def clean_message_parts(parts):
    result = []
    for part in parts:
        text = str(part or "").strip()
        if text and text not in result:
            result.append(text)
    return result


def strip_mentions(text, bot_names):
    cleaned = str(text or "")
    for name in unique_texts(bot_names):
        cleaned = re.sub(rf"@\s*{re.escape(name)}(?=\s|$)", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def parse_message(raw, bot_names):
    if isinstance(raw, dict):
        text = str(raw.get("raw") or raw.get("windowText") or "").strip()
        ui_texts = clean_message_parts(raw.get("texts") or [])
    else:
        text = str(raw or "").strip()
        ui_texts = []
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    sender = None
    body = text

    meaningful_ui_texts = [item for item in ui_texts if not is_timestamp_text(item)]
    if len(meaningful_ui_texts) >= 2:
        sender = meaningful_ui_texts[0]
        body = "\n".join(meaningful_ui_texts[1:]).strip()
    elif len(lines) >= 2 and not is_timestamp_text(lines[0]):
        sender = lines[0]
        body = "\n".join([line for line in lines[1:] if not is_timestamp_text(line)]).strip()
    else:
        match = re.match(r"^([^:\s]{1,40})[:：]\s*(.+)$", text, re.S)
        if match:
            sender = match.group(1).strip()
            body = match.group(2).strip()

    mentions = []
    for name in bot_names:
        if f"@{name}" in body or f"@{name}" in text:
            mentions.append(name)
    mentions = unique_texts(mentions)
    cleaned_body = strip_mentions(body, mentions) if mentions else body.strip()
    sender_is_bot = bool(sender and sender in bot_names)

    return {
        "raw": text,
        "sender": sender,
        "text": cleaned_body or body.strip(),
        "mentioned": len(mentions) > 0,
        "mentions": mentions,
        "senderIsBot": sender_is_bot,
        "debugTexts": ui_texts,
    }


def parse_message_dict(messages_by_chat, bot_names):
    result = []
    for chat, messages in (messages_by_chat or {}).items():
        parsed_messages = [parse_message(message, bot_names) for message in (messages or [])]
        result.append({
            "chat": chat,
            "rawMessages": messages or [],
            "messages": parsed_messages,
        })
    return result


def existing_dialog_window(Desktop, chat_name, timeout=0.2):
    desktop = Desktop(backend="uia")
    window = desktop.window(class_name="mmui::ChatSingleWindow", title=chat_name)
    if window.exists(timeout=timeout):
        return window
    return None


def bind_dialog_windows(Navigator, Desktop, chat_names, minimize):
    result = []
    for chat in chat_names:
        try:
            existing = existing_dialog_window(Desktop, chat)
            if existing:
                result.append({"chat": chat, "bound": True, "reused": True})
                continue
            Navigator.open_seperate_dialog_window(
                friend=chat,
                window_minimize=bool(minimize),
                close_weixin=False,
            )
            result.append({"chat": chat, "bound": True, "reused": False})
        except Exception as exc:
            result.append({"chat": chat, "bound": False, "error": str(exc)})
    return result


def focus_chat_list(chat_list):
    try:
        chat_list.set_focus()
        return True
    except Exception:
        try:
            chat_list.wrapper_object().set_focus()
            return True
        except Exception:
            return False


def extract_visible_messages(dialog_window, ui_lists, count, ensure_bottom, focus_window):
    chat_list = dialog_window.child_window(**ui_lists.FriendChatList)
    if not chat_list.exists(timeout=2):
        return []
    if focus_window:
        focus_dialog_window(dialog_window)
        focus_chat_list(chat_list)
    if ensure_bottom:
        try:
            chat_list.type_keys("{END}")
        except Exception:
            pass
    items = [
        item
        for item in chat_list.children(control_type="ListItem")
        if item.class_name() != "mmui::ChatItemView"
    ]
    messages = []
    for item in items[-count:]:
        window_text = item.window_text()
        try:
            texts = [
                child.window_text()
                for child in item.descendants(control_type="Text")
                if child.window_text()
            ]
        except Exception:
            texts = []
        if str(window_text or "").strip() or texts:
            messages.append({
                "raw": window_text,
                "texts": texts,
            })
    return messages


def peek_messages_for_bound_windows(Desktop, ui_lists, chat_names, count, ensure_bottom, focus_window):
    result = {}
    missing = []
    for chat in chat_names:
        try:
            dialog_window = existing_dialog_window(Desktop, chat)
            if not dialog_window:
                result[chat] = []
                missing.append(chat)
                continue
            result[chat] = extract_visible_messages(
                dialog_window,
                ui_lists,
                count,
                ensure_bottom,
                focus_window,
            )
        except Exception as exc:
            result[chat] = [f"[bridge-error] {exc}"]
    return result, missing


def focus_dialog_window(dialog_window):
    try:
        if dialog_window.is_minimized():
            dialog_window.restore()
    except Exception:
        pass
    try:
        dialog_window.set_focus()
    except Exception:
        try:
            dialog_window.wrapper_object().set_focus()
        except Exception:
            pass


def find_chat_edit(dialog_window, ui_edits):
    edit_area = dialog_window.child_window(**ui_edits.CurrentChatEdit)
    if edit_area.exists(timeout=2):
        return edit_area
    try:
        edits = dialog_window.descendants(control_type="Edit")
    except Exception:
        edits = []
    for item in edits:
        try:
            if item.element_info.automation_id == "chat_input_field":
                return item
        except Exception:
            continue
    visible_edits = []
    for item in edits:
        try:
            if item.is_visible() and item.is_enabled():
                visible_edits.append(item)
        except Exception:
            continue
    return visible_edits[-1] if visible_edits else None


def click_chat_edit(edit_area):
    try:
        edit_area.click_input()
        return True
    except Exception:
        try:
            edit_area.set_focus()
            return True
        except Exception:
            return False


def resolve_bound_chat_edit(Desktop, ui_edits, chat):
    dialog_window = existing_dialog_window(Desktop, chat, timeout=2)
    if not dialog_window:
        return None, None, f"bound chat child window not found: {chat}"
    focus_dialog_window(dialog_window)
    edit_area = find_chat_edit(dialog_window, ui_edits)
    if not edit_area:
        return dialog_window, None, f"chat input box not found in child window: {chat}"
    if not click_chat_edit(edit_area):
        return dialog_window, edit_area, f"chat input box could not be focused: {chat}"
    return dialog_window, edit_area, None


def send_text_to_bound_window(Desktop, ui_edits, SystemSettings, pyautogui, chat, text):
    _dialog_window, _edit_area, error = resolve_bound_chat_edit(Desktop, ui_edits, chat)
    if error:
        return {"ok": False, "error": error}
    SystemSettings.copy_text_to_windowsclipboard(text)
    pyautogui.hotkey("ctrl", "v")
    pyautogui.press("enter")
    return {"ok": True}


def send_files_to_bound_window(Desktop, ui_edits, SystemSettings, pyautogui, chat, files):
    _dialog_window, _edit_area, error = resolve_bound_chat_edit(Desktop, ui_edits, chat)
    if error:
        return {"ok": False, "error": error}
    existing_files = [
        file_path
        for file_path in files
        if isinstance(file_path, str) and os.path.isfile(file_path) and os.path.getsize(file_path) > 0
    ]
    if not existing_files:
        fail("No existing files to send", files)
    for index in range(0, len(existing_files), 9):
        batch = existing_files[index:index + 9]
        SystemSettings.copy_files_to_windowsclipboard(filepaths_list=batch)
        pyautogui.hotkey("ctrl", "v")
        pyautogui.hotkey("alt", "s", _pause=False)
    return {"ok": True}


def main():
    command, args = load_args()
    root = configure_import_path()

    try:
        import pyautogui
        from pywinauto import Desktop
        from pyweixin import Contacts, GlobalConfig, Messages, Monitor, Navigator, Tools
        from pyweixin.WeChatAuto import Edits as UiEdits
        from pyweixin.WeChatAuto import Lists as UiLists
        from pyweixin.WinSettings import SystemSettings

        GlobalConfig.close_weixin = False
        GlobalConfig.is_maximize = args.get("isMaximize", False)

        if command == "status":
            running = bool(Tools.is_weixin_running())
            result = {"ok": True, "enabled": True, "root": root, "running": running}
            if running and args.get("includeProfile") is True:
                try:
                    result["profile"] = Contacts.check_my_info(close_weixin=False)
                except Exception as exc:
                    result["profileError"] = str(exc)
            write_json(result)
            return

        if command == "send-text":
            friend = normalize_text(args.get("friend"), "friend")
            text = normalize_text(args.get("text"), "text")
            bound_send = send_text_to_bound_window(Desktop, UiEdits, SystemSettings, pyautogui, friend, text)
            if bound_send.get("ok"):
                write_json({"ok": True, "sent": True, "friend": friend, "boundWindow": True})
                return
            if args.get("requireBoundWindow") is True:
                fail("bound chat window is required before sending", bound_send.get("error") or friend)
            Messages.send_messages_to_friend(
                friend=friend,
                messages=[text],
                clear=True,
                close_weixin=False,
                is_maximize=args.get("isMaximize", False),
            )
            write_json({"ok": True, "sent": True, "friend": friend})
            return

        if command == "send-files":
            friend = normalize_text(args.get("friend"), "friend")
            files = normalize_text_list(args.get("files"))
            bound_send = send_files_to_bound_window(Desktop, UiEdits, SystemSettings, pyautogui, friend, files)
            if bound_send.get("ok"):
                write_json({"ok": True, "sent": True, "friend": friend, "files": len(files), "boundWindow": True})
                return
            if args.get("requireBoundWindow") is True:
                fail("bound chat window is required before sending files", bound_send.get("error") or friend)
            from pyweixin import Files
            Files.send_files_to_friend(
                friend=friend,
                files=files,
                close_weixin=False,
                is_maximize=args.get("isMaximize", False),
            )
            write_json({"ok": True, "sent": True, "friend": friend, "files": len(files)})
            return

        if command == "bind-chat-windows":
            chat_names = normalize_text_list(args.get("chatNames"))
            if not chat_names:
                fail("chatNames is required for binding chat windows")
            items = bind_dialog_windows(
                Navigator=Navigator,
                Desktop=Desktop,
                chat_names=chat_names,
                minimize=args.get("minimize", False),
            )
            write_json({
                "ok": True,
                "chatNames": chat_names,
                "windows": items,
                "allBound": all(item.get("bound") for item in items),
            })
            return

        if command == "list-groups":
            recent = args.get("recent", True) is not False
            if recent:
                groups = Contacts.get_recent_groups(
                    close_weixin=False,
                    is_maximize=args.get("isMaximize", False),
                )
                items = []
                for item in groups or []:
                    if isinstance(item, (list, tuple)):
                        name = str(item[0]).strip() if len(item) > 0 else ""
                        members = str(item[1]).strip() if len(item) > 1 else None
                        if name:
                            items.append({"name": name, "members": members})
                    elif isinstance(item, str) and item.strip():
                        items.append({"name": item.strip(), "members": None})
                write_json({"ok": True, "groups": items})
                return
            groups = Contacts.get_groups_info(
                close_weixin=False,
                is_maximize=args.get("isMaximize", False),
            )
            write_json({
                "ok": True,
                "groups": [{"name": group, "members": None} for group in (groups or [])],
            })
            return

        if command == "check-new-messages":
            bot_names = normalize_text_list(args.get("botNames"))
            chat_names = normalize_text_list(args.get("chatNames"))
            messages = Monitor.check_new_messages(
                close_weixin=False,
                is_maximize=args.get("isMaximize", False),
                search_pages=args.get("searchPages"),
            )
            messages = filter_messages_by_chat(messages or {}, chat_names)
            write_json({
                "ok": True,
                "messages": messages or {},
                "structured": parse_message_dict(messages or {}, bot_names),
                "chatNames": chat_names,
            })
            return

        if command == "check-mentions":
            bot_names = normalize_text_list(args.get("botNames"))
            chat_names = normalize_text_list(args.get("chatNames"))
            if not chat_names:
                fail("chatNames is required for safe mention listening")
            messages, missing = peek_messages_for_bound_windows(
                Desktop=Desktop,
                ui_lists=UiLists,
                chat_names=chat_names,
                count=int(args.get("messageCount") or 8),
                ensure_bottom=args.get("ensureBottom") is True or args.get("resetPosition") is True,
                focus_window=args.get("focusWindow") is True,
            )
            structured = parse_message_dict(messages or {}, bot_names)
            mentions = []
            for chat_item in structured:
                for message in chat_item["messages"]:
                    if message["mentioned"]:
                        mentions.append({
                            "chat": chat_item["chat"],
                            **message,
                        })
            write_json({
                "ok": True,
                "botNames": bot_names,
                "chatNames": chat_names,
                "missingWindows": missing,
                "mentions": mentions,
                "structured": structured,
            })
            return

        fail("Unsupported command", command)
    except SystemExit:
        raise
    except Exception as exc:
        fail(str(exc), traceback.format_exc(limit=8))


if __name__ == "__main__":
    main()
