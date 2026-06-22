#!/usr/bin/env python3
"""HJ212-2025 本地仿真接收平台（按 HJ 212—2025 原文校准）。"""

import base64
import json
import re
import sys
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify, request

app = Flask(__name__)
TZ = timezone(timedelta(hours=8))
DB = {
    "frames": [],
    "init": [],
    "terminal_info": [],
    "electric": [],
    "process": [],
    "multimedia": [],
    "voc_original": [],
    "encrypted": [],
    "raw": [],
}


SYSTEM_NAMES = {
    "27": "挥发性有机物监测",
    "31": "大气环境污染源",
    "32": "地表水体环境污染源",
    "39": "工地扬尘污染源",
    "44": "用电监控",
    "45": "关键生产工况监控",
    "91": "系统交互",
}

COMMAND_NAMES = {
    "1001": "上传数采仪硬件序号",
    "1002": "设置数采仪MN编码",
    "1014": "现场机获取/上位机下发新密钥",
    "2011": "上传污染物实时数据",
    "2013": "上传原始监测数据",
    "2021": "上传设备运行状态数据",
    "2031": "上传污染物日历史数据",
    "2041": "上传设备运行时间日历史数据",
    "2051": "上传污染物分钟数据",
    "2052": "上传噪声单次测量数据",
    "2061": "上传污染物小时数据",
    "2062": "上传自动标样核查（校准）数据",
    "2081": "上传数采仪开机时间",
    "2111": "上传炉膛温度5min均值",
    "3019": "上传设备唯一标识",
    "3020": "上传现场机信息",
    "3021": "设置现场机参数",
    "9011": "请求应答",
    "9012": "执行结果",
    "9013": "通知应答",
    "9014": "数据应答",
    "9015": "心跳包",
}


def now_iso():
    return datetime.now(TZ).isoformat(timespec="seconds")


def crc16_hj212(text):
    crc = 0xFFFF
    for b in text.encode("utf-8"):
        crc ^= b
        for _ in range(8):
            crc = ((crc >> 1) ^ 0xA001) if (crc & 1) else (crc >> 1)
            crc &= 0xFFFF
    return f"{crc:04X}"


def split_cp(data):
    marker = "CP=&&"
    idx = data.find(marker)
    if idx < 0:
        return data, ""
    cp_start = idx + len(marker)
    cp_end = data.find("&&", cp_start)
    if cp_end < 0:
        raise ValueError("CP 数据区缺少结束 &&")
    return data[:idx] + "CP=__CP__" + data[cp_end + 2:], data[cp_start:cp_end]


def parse_key_values(text, sep=";"):
    out = {}
    for part in [x for x in text.split(sep) if x]:
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        out[k] = v
    return out


def parse_value(v):
    if v == "":
        return v
    try:
        if re.fullmatch(r"-?\d+", v):
            return int(v)
        if re.fullmatch(r"-?\d+\.\d+", v):
            return float(v)
    except Exception:
        pass
    return v


def parse_cp(cp):
    result = {}
    factors = {}
    for group in [x for x in cp.split(";") if x]:
        for item in [x for x in group.split(",") if x]:
            if "=" not in item:
                continue
            k, v = item.split("=", 1)
            v = parse_value(v)
            if "-" not in k:
                result[k] = v
                continue
            factor, field = k.split("-", 1)
            factors.setdefault(factor, {})[field] = v
    if factors:
        result["factors"] = factors
    return result


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
        "version": {0: "HJ/T 212-2005", 1: "HJ 212-2017", 2: "HJ 212-2025"}.get(version_bits, "unknown"),
        "has_packet_no": bool((flag >> 1) & 1),
        "need_ack": bool(flag & 1),
        "valid": True,
    }


def decode_sm4_sim(cp):
    cipher = cp.get("Cipher") or cp.get("CipherText")
    if not cipher:
        return None
    try:
        raw = base64.b64decode(str(cipher)).decode("utf-8")
        return json.loads(raw)
    except Exception as exc:
        return {"decode_error": str(exc), "cipher_preview": str(cipher)[:80]}


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
    sm4_plain = decode_sm4_sim(cp) if cp.get("Alg") == "SM4" or header.get("Encrypt") == "SM4" else None
    st = str(header.get("ST", ""))
    cn = str(header.get("CN", ""))
    return {
        "profile": "HJ212-2025",
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
        "sm4_sim_plain": sm4_plain,
        "encrypted_required_by_standard": cn.startswith("2") or cn in {"1014", "3020"},
    }


def classify(parsed):
    h = parsed["header"]
    cp = parsed.get("cp", {})
    st = str(h.get("ST", ""))
    cn = str(h.get("CN", ""))
    data_type = str(cp.get("DataType", ""))
    if cn in {"1001", "1002"} or data_type == "HardwareSerial":
        return "init"
    if cn == "3020" or data_type == "TerminalInfo":
        return "terminal_info"
    if st == "44" and cn == "2011":
        return "electric"
    if st == "45" and cn == "2011":
        return "process"
    if data_type in {"Video", "Multimedia"} or cp.get("FileType") in {"jpg", "jpeg", "mp4", "h264"}:
        return "multimedia"
    if st == "27" and cn == "2013":
        return "voc_original"
    if parsed.get("sm4_sim_plain") is not None or cp.get("Alg") == "SM4":
        return "encrypted"
    return "frame"


def ok(data=None):
    return jsonify({"ok": True, "data": data})


def bad(msg, status=400):
    return jsonify({"ok": False, "msg": msg}), status


@app.route("/api/hj212-2025/upload", methods=["POST"])
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
        rec = {"time": now_iso(), "raw": raw, "error": str(exc)}
        DB["raw"].append(rec)
        DB["raw"] = DB["raw"][-200:]
        return bad(str(exc))
    kind = classify(parsed)
    rec = {"time": now_iso(), "type": kind, "raw": raw, "parsed": parsed}
    DB["frames"].append(rec)
    DB["frames"] = DB["frames"][-200:]
    if kind in DB:
        DB[kind].append(rec)
        DB[kind] = DB[kind][-100:]
    DB["raw"].append(rec)
    DB["raw"] = DB["raw"][-200:]
    h = parsed["header"]
    factors = parsed.get("cp", {}).get("factors", {})
    print(f"[HJ212-2025] type={kind} crc={parsed['crc_ok']} ST={h.get('ST')} CN={h.get('CN')} MN={h.get('MN')} factors={len(factors)}", flush=True)
    return ok({
        "type": kind,
        "crc_ok": parsed["crc_ok"],
        "flag": parsed["flag"],
        "system_name": parsed["system_name"],
        "command_name": parsed["command_name"],
        "header": h,
        "factor_count": len(factors),
        "encrypted_required_by_standard": parsed["encrypted_required_by_standard"],
        "sm4_sim_decoded": parsed.get("sm4_sim_plain") is not None,
    })


@app.route("/api/status")
def status():
    return jsonify({
        "time": now_iso(),
        "profile": "HJ212-2025",
        "frame_count": len(DB["frames"]),
        "init_count": len(DB["init"]),
        "terminal_info_count": len(DB["terminal_info"]),
        "electric_count": len(DB["electric"]),
        "process_count": len(DB["process"]),
        "multimedia_count": len(DB["multimedia"]),
        "voc_original_count": len(DB["voc_original"]),
        "encrypted_count": len(DB["encrypted"]),
        "recent": DB["frames"][-10:],
    })


@app.route("/")
def index():
    return """<!doctype html><meta charset='utf-8'><title>HJ212-2025 仿真平台</title>
<style>body{font-family:ui-monospace,Menlo,monospace;background:#10131f;color:#d8dee9;padding:24px}a{color:#88c0d0}pre{background:#1b2033;padding:16px;border-radius:8px;white-space:pre-wrap}</style>
<h1>HJ212-2025 仿真接收平台</h1>
<p>上传接口：<code>POST /api/hj212-2025/upload</code></p>
<p>已按原文校准：Flag=9 版本位、ST=44 用电、ST=45 工况、CN=2013 VOC原始数据、CN=3020现场机信息、UTF-8字节长度解析。</p>
<p><a href='/api/status'>查看 JSON 状态</a></p>
<pre id='out'>loading...</pre>
<script>async function load(){out.textContent=JSON.stringify(await (await fetch('/api/status')).json(),null,2)}load();setInterval(load,3000)</script>"""


if __name__ == "__main__":
    port = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[1] == "--port" else 5906
    print(f"HJ212-2025 仿真平台: http://127.0.0.1:{port}", flush=True)
    app.run(host="0.0.0.0", port=port, debug=False)
