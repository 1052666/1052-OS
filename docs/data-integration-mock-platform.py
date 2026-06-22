#!/usr/bin/env python3
"""数据对接接口.docx 本地仿真接收平台。"""

import json
import sys
from datetime import datetime

from flask import Flask, jsonify, request

app = Flask(__name__)
DB = {"alarm": [], "param": [], "raw": []}


def now():
    return datetime.now().isoformat(timespec="seconds")


def ok():
    return jsonify({"result": True, "msg": "成功"})


def bad(msg):
    return jsonify({"result": False, "msg": msg}), 400


def expect_array():
    data = request.get_json(silent=True)
    if not isinstance(data, list):
        return None, bad("请求体必须是JSON数组")
    return data, None


@app.route("/web_service/ws/cz_alarm/putMonitorData", methods=["POST"])
def put_monitor_data():
    data, err = expect_array()
    if err:
        return err
    for item in data:
        if not all(k in item for k in ("qyid", "detectorno", "flag")):
            return bad("报警数据缺少 qyid/detectorno/flag")
    record = {"time": now(), "items": data, "count": len(data)}
    DB["alarm"].append(record)
    DB["alarm"] = DB["alarm"][-200:]
    DB["raw"].append({"type": "alarm", **record})
    DB["raw"] = DB["raw"][-200:]
    summary = ", ".join(f"{x.get('detectorno')}:{x.get('flag')}" for x in data[:5])
    print(f"[ALARM] count={len(data)} {summary}", flush=True)
    return ok()


@app.route("/web_service/ws/cz_alarm/putMonitorParamData", methods=["POST"])
def put_monitor_param_data():
    data, err = expect_array()
    if err:
        return err
    for item in data:
        if not all(k in item for k in ("qyid", "tankno", "detectorno", "monitor_value")):
            return bad("实时参数缺少 qyid/tankno/detectorno/monitor_value")
    record = {"time": now(), "items": data, "count": len(data)}
    DB["param"].append(record)
    DB["param"] = DB["param"][-200:]
    DB["raw"].append({"type": "param", **record})
    DB["raw"] = DB["raw"][-200:]
    summary = ", ".join(f"{x.get('detectorno')}:{x.get('monitor_value')}" for x in data[:5])
    print(f"[PARAM] count={len(data)} {summary}", flush=True)
    return ok()


@app.route("/api/status")
def status():
    return jsonify({
        "time": now(),
        "alarm_count": len(DB["alarm"]),
        "param_count": len(DB["param"]),
        "recent_alarm": DB["alarm"][-10:],
        "recent_param": DB["param"][-10:],
        "recent_raw": DB["raw"][-20:],
    })


@app.route("/")
def index():
    return """<!doctype html><meta charset='utf-8'><title>数据对接接口仿真平台</title>
<style>body{font-family:ui-monospace,Menlo,monospace;background:#10131f;color:#d8dee9;padding:24px}pre{background:#1b2033;padding:16px;border-radius:8px;white-space:pre-wrap}</style>
<h1>数据对接接口仿真平台</h1>
<p>报警接口：<code>/web_service/ws/cz_alarm/putMonitorData</code></p>
<p>实时参数接口：<code>/web_service/ws/cz_alarm/putMonitorParamData</code></p>
<pre id='out'>loading...</pre>
<script>async function load(){out.textContent=JSON.stringify(await (await fetch('/api/status')).json(),null,2)}load();setInterval(load,3000)</script>"""


if __name__ == "__main__":
    port = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[1] == "--port" else 5904
    print(f"数据对接接口仿真平台: http://127.0.0.1:{port}", flush=True)
    app.run(host="0.0.0.0", port=port, debug=False)
