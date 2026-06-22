#!/usr/bin/env python3
"""粉尘涉爆企业监测预警系统数据上传接口 V1.1 仿真平台。"""

import base64
import json
import sys
from datetime import datetime, timedelta, timezone

from Crypto.Cipher import DES
from Crypto.Util.Padding import unpad
from flask import Flask, Response, jsonify, request

app = Flask(__name__)
TZ = timezone(timedelta(hours=8))
SECRET_KEY = b"ab23dcef"
IV = b"12345678"

DB = {
    "rts": [],
    "events": [],
    "videos": [],
    "raw": [],
    "last_video_img": "",
}


def now_iso():
    return datetime.now(TZ).isoformat()


def des_decrypt(hex_str):
    raw = base64.b64decode(bytes.fromhex(hex_str))
    cipher = DES.new(SECRET_KEY, DES.MODE_CBC, iv=IV)
    plain = unpad(cipher.decrypt(raw), DES.block_size)
    return json.loads(plain.decode("utf-8"))


def ok(data=None):
    return jsonify({"code": 200, "msg": "操作成功", "data": data})


def fail(msg):
    return jsonify({"code": 500, "msg": msg, "data": None}), 400


def save_raw(kind, body, plain, response):
    DB["raw"].append({
        "type": kind,
        "qybm": body.get("qybm", ""),
        "wgbm": body.get("wgbm", ""),
        "encrypted": body.get("data", ""),
        "decrypted": plain,
        "response": response,
        "received_at": now_iso(),
    })
    DB["raw"] = DB["raw"][-100:]


@app.route("/rabbitmqfcsb/api/rtsData", methods=["POST"])
def rts_data():
    body = request.json or {}
    enc_data = body.get("data")
    if not enc_data:
        return fail("data字段为空")
    try:
        plain = des_decrypt(enc_data)
    except Exception as exc:
        return fail(f"DES解密失败: {exc}")
    rts = plain.get("data", {}).get("rts", [])
    record = {
        "qybm": body.get("qybm", ""),
        "wgbm": body.get("wgbm", ""),
        "rts": rts,
        "received_at": now_iso(),
    }
    DB["rts"].append(record)
    DB["rts"] = DB["rts"][-200:]
    resp = {"code": 200, "msg": "操作成功", "data": None}
    save_raw("rtsData", body, plain, resp)
    vals = ", ".join(f"{x.get('tnm', '')[-6:]}:{x.get('val')}" for x in rts[:5])
    print(f"[RTS] qybm={record['qybm']} wgbm={record['wgbm']} items={len(rts)} {vals}", flush=True)
    return ok()


@app.route("/rabbitmqfcsb/api/eventsData", methods=["POST"])
def events_data():
    body = request.json or {}
    enc_data = body.get("data")
    if not enc_data:
        return fail("data字段为空")
    try:
        plain = des_decrypt(enc_data)
    except Exception as exc:
        return fail(f"DES解密失败: {exc}")
    events = plain.get("data", {}).get("events", [])
    record = {
        "qybm": body.get("qybm", ""),
        "events": events,
        "received_at": now_iso(),
    }
    DB["events"].append(record)
    DB["events"] = DB["events"][-200:]
    resp = {"code": 200, "msg": "操作成功", "data": None}
    save_raw("eventsData", body, plain, resp)
    for event in events:
        print(f"[EVENT] {event.get('oname', '')[-6:]} scd={event.get('scd')} avx={event.get('avx')} content={event.get('content')}", flush=True)
    return ok()


@app.route("/rabbitmqfcsb/api/videosData", methods=["POST"])
def videos_data():
    body = request.json or {}
    enc_data = body.get("data")
    img = body.get("img", "")
    if not enc_data:
        return fail("data字段为空")
    if not img:
        return fail("img字段为空")
    try:
        plain = des_decrypt(enc_data)
    except Exception as exc:
        return fail(f"DES解密失败: {exc}")
    data = plain.get("data", {})
    record = {
        "qybm": body.get("qybm", ""),
        "video": data,
        "img_size": len(img),
        "received_at": now_iso(),
    }
    DB["last_video_img"] = img
    DB["videos"].append(record)
    DB["videos"] = DB["videos"][-200:]
    resp = {"code": 200, "msg": "操作成功", "data": None}
    save_raw("videosData", body, plain, resp)
    print(f"[VIDEO] videoCode={data.get('videoCode')} alarmType={data.get('alarmType')} img={len(img)}", flush=True)
    return ok()


@app.route("/api/status")
def status():
    recent_rts = [
        {
            "time": item["received_at"],
            "qybm": item["qybm"],
            "wgbm": item["wgbm"],
            "count": len(item["rts"]),
            "items": item["rts"],
        }
        for item in DB["rts"][-10:]
    ]
    recent_events = []
    for item in DB["events"][-10:]:
        for event in item["events"]:
            recent_events.append({"time": item["received_at"], **event})
    recent_videos = [
        {
            "time": item["received_at"],
            "qybm": item["qybm"],
            "img_size": item["img_size"],
            **item["video"],
        }
        for item in DB["videos"][-10:]
    ]
    return jsonify({
        "time": now_iso(),
        "rts_count": len(DB["rts"]),
        "events_count": len(DB["events"]),
        "videos_count": len(DB["videos"]),
        "last_video_img_size": len(DB["last_video_img"]),
        "last_video_img_preview_url": "/api/last-video-image" if DB["last_video_img"] else "",
        "recent_rts": recent_rts,
        "recent_events": recent_events,
        "recent_videos": recent_videos,
        "recent_raw": [
            {
                "type": item["type"],
                "time": item["received_at"],
                "qybm": item["qybm"],
                "wgbm": item["wgbm"],
                "plain_summary": json.dumps(item["decrypted"], ensure_ascii=False)[:240],
            }
            for item in DB["raw"][-20:]
        ],
    })


@app.route("/api/last-video-image.jpg")
def last_video_image_jpg():
    img = DB["last_video_img"]
    if not img:
        return fail("暂无视频报警图片")
    data = base64.b64decode(img)
    return Response(data, mimetype="image/jpeg")


@app.route("/api/last-video-image")
def last_video_image():
    img = DB["last_video_img"]
    if not img:
        return fail("暂无视频报警图片")
    return f"""<!doctype html><meta charset='utf-8'><title>最后一张视频报警图片</title>
<style>body{{font-family:ui-monospace,Menlo,monospace;background:#10131f;color:#d8dee9;padding:24px}}img{{max-width:96vw;max-height:80vh;border:1px solid #3b4252}}a{{color:#88c0d0}}</style>
<h1>最后一张视频报警图片</h1>
<p>base64 长度：{len(img)} · <a href='/api/last-video-image.jpg' target='_blank'>直接打开 JPEG</a></p>
<img src='/api/last-video-image.jpg'>"""


@app.route("/")
def index():
    return """<!doctype html><meta charset='utf-8'><title>粉尘涉爆 V1.1 仿真平台</title>
<style>body{font-family:ui-monospace,Menlo,monospace;background:#10131f;color:#d8dee9;padding:24px}a{color:#88c0d0}pre{background:#1b2033;padding:16px;border-radius:8px;white-space:pre-wrap}</style>
<h1>粉尘涉爆监测预警系统 V1.1 仿真平台</h1>
<p>接口前缀：<code>/rabbitmqfcsb/api/</code></p>
<p><a href='/api/status'>查看 JSON 状态</a> · <a href='/api/last-video-image'>查看最后一张视频报警图片</a></p>
<pre id='out'>loading...</pre>
<script>async function load(){out.textContent=JSON.stringify(await (await fetch('/api/status')).json(),null,2)}load();setInterval(load,3000)</script>"""


if __name__ == "__main__":
    port = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[1] == "--port" else 5902
    print(f"粉尘涉爆 V1.1 仿真平台: http://127.0.0.1:{port}", flush=True)
    app.run(host="0.0.0.0", port=port, debug=False)
