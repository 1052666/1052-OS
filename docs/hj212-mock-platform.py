#!/usr/bin/env python3
"""HJ212-2017 本地仿真接收平台。"""

import json
import re
import sys
from datetime import datetime, timezone, timedelta

from flask import Flask, jsonify, request

app = Flask(__name__)
TZ = timezone(timedelta(hours=8))
DB = {"frames": [], "raw": []}

SYSTEM_NAMES = {
    "21": "地表水质量监测",
    "22": "空气质量监测",
    "23": "声环境质量监测",
    "24": "地下水质量监测",
    "25": "土壤质量监测",
    "26": "海水质量监测",
    "27": "挥发性有机物监测",
    "31": "大气环境污染源",
    "32": "地表水体环境污染源",
    "33": "地下水体环境污染源",
    "34": "海洋环境污染源",
    "35": "土壤环境污染源",
    "36": "声环境污染源",
    "37": "振动环境污染源",
    "38": "放射性环境污染源",
    "39": "工地扬尘污染源",
    "41": "电磁环境污染源",
    "51": "烟气排放过程监控",
    "52": "污水排放过程监控",
    "91": "系统交互",
}

COMMAND_NAMES = {
    "1000": "设置超时时间及重发次数",
    "1011": "提取/上传现场机时间",
    "1012": "设置现场机时间",
    "1013": "现场机时间校准请求",
    "1061": "提取/上传实时数据间隔",
    "1062": "设置实时数据间隔",
    "1063": "提取/上传分钟数据间隔",
    "1064": "设置分钟数据间隔",
    "1072": "设置现场机密码",
    "2011": "取/上传污染物实时数据",
    "2012": "停止察看污染物实时数据",
    "2021": "取/上传设备运行状态数据",
    "2022": "停止察看设备运行状态",
    "2031": "取/上传污染物日历史数据",
    "2041": "取/上传设备运行时间日历史数据",
    "2051": "取/上传污染物分钟数据",
    "2061": "取/上传污染物小时数据",
    "2081": "上传数采仪开机时间",
    "3011": "零点校准量程校准",
    "3012": "即时采样",
    "3013": "启动清洗/反吹",
    "3014": "比对采样",
    "3015": "超标留样/上传超标留样信息",
    "3016": "设置采样时间周期",
    "3017": "提取/上传采样时间周期",
    "3018": "提取/上传出样时间",
    "3019": "提取/上传设备唯一标识",
    "3020": "提取/上传现场机信息",
    "3021": "设置现场机参数",
    "9011": "请求应答",
    "9012": "执行结果",
    "9013": "通知应答",
    "9014": "数据应答",
}


def flag_info(flag_value):
    try:
        flag = int(flag_value)
    except Exception:
        return {"raw": flag_value, "valid": False}
    version_bits = (flag >> 2) & 0b111111
    return {
        "raw": flag,
        "binary": format(flag, "08b"),
        "version_bits": format(version_bits, "06b"),
        "version": {0: "HJ/T 212-2005", 1: "HJ 212-2017"}.get(version_bits, "unknown"),
        "has_packet_no": bool(flag & 0b10),
        "need_ack": bool(flag & 0b1),
        "valid": True,
    }


def now_iso():
    return datetime.now(TZ).isoformat(timespec="seconds")


def crc16_hj212(text):
    crc = 0xFFFF
    for b in text.encode("utf-8"):
        crc ^= b
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
            crc &= 0xFFFF
    return f"{crc:04X}"


def split_cp(data):
    marker = "CP=&&"
    idx = data.find(marker)
    if idx < 0:
        return data, ""
    prefix = data[:idx]
    cp_start = idx + len(marker)
    cp_end = data.find("&&", cp_start)
    if cp_end < 0:
        raise ValueError("CP 数据区缺少结束 &&")
    cp = data[cp_start:cp_end]
    suffix = data[cp_end + 2:]
    main = prefix + "CP=__CP__" + suffix
    return main, cp


def parse_key_values(text, sep=";"):
    out = {}
    for part in [x for x in text.split(sep) if x]:
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        out[k] = v
    return out


def parse_cp(cp):
    result = {}
    factors = {}
    for group in [x for x in cp.split(";") if x]:
        for item in [x for x in group.split(",") if x]:
            if "=" not in item:
                continue
            k, v = item.split("=", 1)
            if "-" not in k:
                result[k] = v
                continue
            factor, field = k.split("-", 1)
            factors.setdefault(factor, {})[field] = v
    if factors:
        result["factors"] = factors
    return result


def parse_frame(raw):
    frame = raw.strip()
    if not frame.startswith("##"):
        raise ValueError("报文必须以 ## 开头")
    frame_bytes = frame.encode("utf-8")
    if len(frame_bytes) < 10:
        raise ValueError("报文长度不足")
    length_text = frame[2:6]
    if not re.fullmatch(r"\d{4}", length_text):
        raise ValueError("长度字段必须是 4 位数字")
    declared_len = int(length_text)
    data_start = 6
    data_end = data_start + declared_len
    data_bytes = frame_bytes[data_start:data_end]
    if len(data_bytes) != declared_len:
        raise ValueError("数据段实际字节数与长度字段不一致")
    try:
        data = data_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError(f"数据段 UTF-8 解码失败: {exc}") from exc
    crc_given = frame_bytes[data_end:data_end + 4].decode("ascii", errors="ignore").upper()
    if not re.fullmatch(r"[0-9A-F]{4}", crc_given or ""):
        raise ValueError("CRC 字段必须是 4 位 HEX")
    crc_calc = crc16_hj212(data)
    main, cp_text = split_cp(data)
    header = parse_key_values(main)
    if header.get("CP") == "__CP__":
        header.pop("CP", None)
    cp = parse_cp(cp_text) if cp_text else {}
    st = str(header.get("ST", ""))
    cn = str(header.get("CN", ""))
    return {
        "profile": "HJ212-2017",
        "valid": crc_given == crc_calc,
        "length": declared_len,
        "actual_length": len(data_bytes),
        "crc_given": crc_given,
        "crc_calc": crc_calc,
        "crc_ok": crc_given == crc_calc,
        "header": header,
        "flag": flag_info(header.get("Flag")),
        "system_name": SYSTEM_NAMES.get(st, "未知系统编码"),
        "command_name": COMMAND_NAMES.get(cn, "未知命令编码"),
        "cp_raw": cp_text,
        "cp": cp,
    }


def ok(data=None):
    return jsonify({"ok": True, "data": data})


def bad(msg, status=400):
    return jsonify({"ok": False, "msg": msg}), status


@app.route("/api/hj212/upload", methods=["POST"])
def upload():
    raw = request.get_data(as_text=True)
    if request.is_json:
        body = request.get_json(silent=True) or {}
        raw = body.get("frame", raw)
    if not raw:
        return bad("报文为空")
    try:
        parsed = parse_frame(raw)
    except Exception as exc:
        DB["raw"].append({"time": now_iso(), "raw": raw, "error": str(exc)})
        DB["raw"] = DB["raw"][-200:]
        return bad(str(exc))
    record = {"time": now_iso(), "raw": raw, "parsed": parsed}
    DB["frames"].append(record)
    DB["frames"] = DB["frames"][-200:]
    DB["raw"].append(record)
    DB["raw"] = DB["raw"][-200:]
    header = parsed["header"]
    factors = parsed.get("cp", {}).get("factors", {})
    print(
        f"[HJ212] valid={parsed['valid']} MN={header.get('MN')} CN={header.get('CN')} factors={len(factors)}",
        flush=True,
    )
    return ok({
        "crc_ok": parsed["crc_ok"],
        "flag": parsed["flag"],
        "system_name": parsed["system_name"],
        "command_name": parsed["command_name"],
        "header": header,
        "factor_count": len(factors),
    })


@app.route("/api/hj212/parse", methods=["POST"])
def parse_api():
    body = request.get_json(silent=True) or {}
    raw = body.get("frame") or request.get_data(as_text=True)
    if not raw:
        return bad("报文为空")
    try:
        return ok(parse_frame(raw))
    except Exception as exc:
        return bad(str(exc))


@app.route("/api/status")
def status():
    return jsonify({
        "time": now_iso(),
        "frame_count": len(DB["frames"]),
        "recent": DB["frames"][-10:],
        "recent_raw": DB["raw"][-20:],
    })


@app.route("/")
def index():
    return """<!doctype html><meta charset='utf-8'><title>HJ212-2017 仿真平台</title>
<style>body{font-family:ui-monospace,Menlo,monospace;background:#10131f;color:#d8dee9;padding:24px}a{color:#88c0d0}pre{background:#1b2033;padding:16px;border-radius:8px;white-space:pre-wrap}</style>
<h1>HJ212-2017 仿真接收平台</h1>
<p>上传接口：<code>POST /api/hj212/upload</code>，请求体可为原始 HJ212 文本或 <code>{"frame":"..."}</code></p>
<p><a href='/api/status'>查看 JSON 状态</a></p>
<pre id='out'>loading...</pre>
<script>async function load(){out.textContent=JSON.stringify(await (await fetch('/api/status')).json(),null,2)}load();setInterval(load,3000)</script>"""


if __name__ == "__main__":
    port = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[1] == "--port" else 5905
    print(f"HJ212-2017 仿真平台: http://127.0.0.1:{port}", flush=True)
    app.run(host="0.0.0.0", port=port, debug=False)
