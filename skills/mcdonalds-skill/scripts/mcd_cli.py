#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime

DEFAULT_URL = os.environ.get("MCDONALDS_MCP_URL", "https://mcp.mcd.cn")
DEFAULT_PROTOCOL_VERSION = "2024-11-05"
DEFAULT_CLIENT_INFO = {"name": "1052-mcd-cli", "version": "1.0.0"}


class McdMcpError(Exception):
    pass


def build_headers(token: str):
    return {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": f"Bearer {token}",
    }


def post_json(url: str, token: str, payload: dict):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url=url, data=data, headers=build_headers(token), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            status = getattr(resp, "status", None) or resp.getcode()
            content_type = resp.headers.get("Content-Type", "")
            return {
                "status": status,
                "content_type": content_type,
                "text": body,
            }
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {
            "status": e.code,
            "content_type": e.headers.get("Content-Type", ""),
            "text": body,
        }
    except Exception as e:
        raise McdMcpError(str(e)) from e


def parse_jsonrpc_text(text: str):
    text = text.strip()
    if not text:
        raise McdMcpError("响应为空")

    if text.startswith("data:"):
        lines = [line[5:].strip() for line in text.splitlines() if line.startswith("data:")]
        for line in reversed(lines):
            if line and line != "[DONE]":
                return json.loads(line)
        raise McdMcpError("未在 SSE 响应中解析到 JSON 数据")

    return json.loads(text)


def jsonrpc_request(url: str, token: str, method: str, params: dict, req_id: int = 1):
    raw = post_json(url, token, {
        "jsonrpc": "2.0",
        "id": req_id,
        "method": method,
        "params": params,
    })
    parsed = None
    try:
        parsed = parse_jsonrpc_text(raw["text"])
    except Exception:
        parsed = None
    return raw, parsed


def initialize(url: str, token: str):
    return jsonrpc_request(url, token, "initialize", {
        "protocolVersion": DEFAULT_PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": DEFAULT_CLIENT_INFO,
    }, req_id=1)


def list_tools(url: str, token: str):
    return jsonrpc_request(url, token, "tools/list", {}, req_id=2)


def call_tool(url: str, token: str, tool_name: str, arguments: dict):
    return jsonrpc_request(url, token, "tools/call", {
        "name": tool_name,
        "arguments": arguments,
    }, req_id=3)


def require_token(cli_token: str | None):
    token = cli_token or os.environ.get("MCDONALDS_MCP_TOKEN")
    if not token:
        raise McdMcpError("缺少 token，请通过 --token 传入，或设置环境变量 MCDONALDS_MCP_TOKEN")
    return token


def summarize_tools(parsed: dict):
    tools = (((parsed or {}).get("result") or {}).get("tools") or [])
    return [{
        "name": tool.get("name"),
        "description": tool.get("description", "")[:120],
        "inputSchema": tool.get("inputSchema"),
    } for tool in tools]


def print_json(data):
    print(json.dumps(data, ensure_ascii=False, indent=2))


def parse_args_json(args_text: str | None):
    if not args_text:
        return {}
    try:
        obj = json.loads(args_text)
    except json.JSONDecodeError as e:
        raise McdMcpError(f"--args 不是合法 JSON：{e}") from e
    if not isinstance(obj, dict):
        raise McdMcpError("--args 必须是 JSON 对象")
    return obj


def cmd_init(args):
    token = require_token(args.token)
    raw, parsed = initialize(args.url, token)
    result = {
        "ok": raw["status"] == 200 and isinstance(parsed, dict) and "result" in parsed,
        "request": "initialize",
        "http_status": raw["status"],
        "content_type": raw["content_type"],
        "parsed": parsed,
        "raw_text": None if args.no_raw_text else raw["text"],
    }
    print_json(result)
    return 0 if result["ok"] else 1


def cmd_list_tools(args):
    token = require_token(args.token)
    raw, parsed = list_tools(args.url, token)
    tools_summary = summarize_tools(parsed) if parsed else []
    result = {
        "ok": raw["status"] == 200 and isinstance(parsed, dict) and "result" in parsed,
        "request": "tools/list",
        "http_status": raw["status"],
        "content_type": raw["content_type"],
        "tool_count": len(tools_summary),
        "tools": parsed if args.raw else tools_summary,
        "raw_text": None if (args.no_raw_text or args.raw) else raw["text"],
    }
    print_json(result)
    return 0 if result["ok"] else 1


def cmd_call(args):
    token = require_token(args.token)
    arguments = parse_args_json(args.args)
    raw, parsed = call_tool(args.url, token, args.tool, arguments)
    result = {
        "ok": raw["status"] == 200 and isinstance(parsed, dict) and "result" in parsed and "error" not in parsed,
        "request": "tools/call",
        "tool": args.tool,
        "arguments": arguments,
        "http_status": raw["status"],
        "content_type": raw["content_type"],
        "parsed": parsed,
        "raw_text": None if args.no_raw_text else raw["text"],
    }
    print_json(result)
    return 0 if result["ok"] else 1


def choose_smoke_tool(tool_names):
    preferred = [
        "now-time-info",
        "campaign-calendar",
        "available-coupons",
    ]
    for name in preferred:
        if name in tool_names:
            return name
    return tool_names[0] if tool_names else None


def cmd_smoke_test(args):
    token = require_token(args.token)
    report = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "url": args.url,
        "steps": {},
        "summary": {
            "ok": False,
        }
    }

    init_raw, init_parsed = initialize(args.url, token)
    report["steps"]["initialize"] = {
        "ok": init_raw["status"] == 200 and isinstance(init_parsed, dict) and "result" in init_parsed,
        "http_status": init_raw["status"],
        "parsed": init_parsed,
    }

    list_raw, list_parsed = list_tools(args.url, token)
    tools_summary = summarize_tools(list_parsed) if list_parsed else []
    tool_names = [t.get("name") for t in tools_summary if t.get("name")]
    report["steps"]["tools_list"] = {
        "ok": list_raw["status"] == 200 and isinstance(list_parsed, dict) and "result" in list_parsed,
        "http_status": list_raw["status"],
        "tool_count": len(tools_summary),
        "tools_preview": tool_names[:20],
    }

    smoke_tool = choose_smoke_tool(tool_names)
    report["steps"]["tool_call"] = {
        "selected_tool": smoke_tool,
        "ok": False,
    }
    if smoke_tool:
        call_raw, call_parsed = call_tool(args.url, token, smoke_tool, {})
        report["steps"]["tool_call"] = {
            "selected_tool": smoke_tool,
            "ok": call_raw["status"] == 200 and isinstance(call_parsed, dict) and "result" in call_parsed and "error" not in call_parsed,
            "http_status": call_raw["status"],
            "parsed": call_parsed,
        }

    report["summary"] = {
        "ok": all(step.get("ok") for step in report["steps"].values()),
        "tool_count": len(tools_summary),
        "smoke_tool": smoke_tool,
    }

    if args.out:
        os.makedirs(os.path.dirname(args.out), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

    print_json(report)
    return 0 if report["summary"]["ok"] else 1


def build_parser():
    parser = argparse.ArgumentParser(description="McDonalds MCP local CLI")
    parser.add_argument("--url", default=DEFAULT_URL, help="MCP URL，默认 https://mcp.mcd.cn")
    parser.add_argument("--token", help="Bearer token，也可使用环境变量 MCDONALDS_MCP_TOKEN")

    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init", help="初始化 MCP")
    p_init.add_argument("--no-raw-text", action="store_true", help="不输出原始文本")
    p_init.set_defaults(func=cmd_init)

    p_list = sub.add_parser("list-tools", help="列出工具")
    p_list.add_argument("--raw", action="store_true", help="输出完整 parsed JSON，而不是摘要")
    p_list.add_argument("--no-raw-text", action="store_true", help="不输出原始文本")
    p_list.set_defaults(func=cmd_list_tools)

    p_call = sub.add_parser("call", help="调用工具")
    p_call.add_argument("--tool", required=True, help="工具名")
    p_call.add_argument("--args", help="JSON 对象字符串，默认 {}")
    p_call.add_argument("--no-raw-text", action="store_true", help="不输出原始文本")
    p_call.set_defaults(func=cmd_call)

    p_smoke = sub.add_parser("smoke-test", help="一键 smoke test")
    p_smoke.add_argument("--out", help="将测试结果输出到 JSON 文件")
    p_smoke.set_defaults(func=cmd_smoke_test)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except McdMcpError as e:
        print_json({"ok": False, "error": str(e)})
        return 2
    except KeyboardInterrupt:
        print_json({"ok": False, "error": "用户中断"})
        return 130


if __name__ == "__main__":
    sys.exit(main())
