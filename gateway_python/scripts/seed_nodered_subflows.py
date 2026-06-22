"""
Seed Node-RED userDir with the 23 subflow patterns from
~/.claude/skills/node-red/snippets/subflow-patterns.md + a demo flow that
chains several patterns end-to-end and writes to /api/td/insert.

Output: ~/.1052os/node-red/flows.json (idempotent — re-running overwrites)

Usage:
    python scripts/seed_nodered_subflows.py                    # → ~/.1052os/node-red/
    python scripts/seed_nodered_subflows.py --user-dir /tmp/nr  # → /tmp/nr/
    python scripts/seed_nodered_subflows.py --gateway http://x:9000  # override API url
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

# Re-use the same bootstrap flow the runtime uses, so node-red shows the
# 1052os-bootstrap tab when first opened.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gateway.nodered_runtime import _bootstrap_flow  # noqa: E402


# Source files: 5 categories × patterns each = 23 subflows.
SOURCE_FILES = [
    "/tmp/nodered-subflow-patterns/01-reliability.md",
    "/tmp/nodered-subflow-patterns/02-filtering.md",
    "/tmp/nodered-subflow-patterns/03-aggregation.md",
    "/tmp/nodered-subflow-patterns/04-state-alarm.md",
    "/tmp/nodered-subflow-patterns/05-distribution-time.md",
]

# 23 subflow ids we expect to find — used to verify the count after extraction.
EXPECTED_SUBFLOWS = {
    # reliability
    "sf_trycatch", "sf_retry", "sf_watchdog", "sf_ratelimit", "sf_breaker",
    # filtering
    "sf_debounce", "sf_dedupe", "sf_change_detector", "sf_ema", "sf_median",
    # aggregation
    "sf_batch", "sf_sliding_window", "sf_groupby", "sf_rate",
    # state/alarm
    "sf_state_machine", "sf_alarm_hyst", "sf_deadband", "sf_latch",
    # distribution/time
    "sf_round_robin", "sf_priority", "sf_fanout", "sf_cron_gate", "sf_heartbeat",
}


def extract_subflows(md_paths: list[str]) -> list[dict]:
    r"""Parse all ```json blocks across the markdown files; keep subflows.

    A subflow definition has ``"type": "subflow"`` at the top level. We
    skip everything else (demo flows, usage examples). Some blocks wrap the
    subflow in a one-element array — those are unwrapped first.
    """
    pat = re.compile(r"```json\s*\n(.*?)\n```", re.DOTALL)
    out: list[dict] = []
    for p in md_paths:
        text = Path(p).read_text(encoding="utf-8")
        for m in pat.finditer(text):
            try:
                obj = json.loads(m.group(1))
            except json.JSONDecodeError as e:
                print(f"[warn] skip malformed JSON in {p}: {e}", file=sys.stderr)
                continue
            # Accept both single-object and one-element-array wrapping.
            candidates = obj if isinstance(obj, list) else [obj]
            for c in candidates:
                if isinstance(c, dict) and c.get("type") == "subflow":
                    out.append(c)
    return out


def _demo_tab() -> dict:
    """Demo tab: inject(1s) → sf_dedupe → sf_ema → sf_batch → POST /api/td/insert.

    This single tab exercises 4 of the 23 patterns end-to-end. Users see
    immediately that the chain works against the gateway /api/td/insert.
    """
    return {
        "id": "tab_demo_chain",
        "type": "tab",
        "label": "demo:采集链 → /api/td/insert",
        "disabled": False,
        "info": "# Demo: end-to-end采集链\n\n"
                "每 1 秒 inject 一次模拟数据 → sf_dedupe(去重)→ sf_ema(平滑)"
                "→ sf_batch(攒批)→ POST /api/td/insert → TDengine。\n\n"
                "演示用,删除后不会重新生成。",
    }


def build_demo_flow_nodes() -> list[dict]:
    """The wiring for the demo tab. Returns the nodes (no tab) — flow is added
    separately so the demo tab + 23 subflows + bootstrap all live in one
    flows.json."""
    nodes: list[dict] = []
    seen_ids: set[str] = set()

    def add(node: dict) -> None:
        if node["id"] in seen_ids:
            raise ValueError(f"duplicate id in demo: {node['id']}")
        seen_ids.add(node["id"])
        nodes.append(node)

    # 1) inject(1s) — mock raw sensor data
    add({
        "id": "demo_inj",
        "type": "inject",
        "z": "tab_demo_chain",
        "name": "sim temp (1s)",
        "props": [{"p": "payload"}],
        "repeat": "1",
        "crontab": "",
        "once": False,
        "onceDelay": "0.1",
        "topic": "demo/sensor",
        "payload": "21.5",
        "payloadType": "num",
        "x": 140, "y": 140, "wires": [["demo_fn_to_msg"]],
    })

    # 2) function — wrap value as /api/td/insert body
    add({
        "id": "demo_fn_to_msg",
        "type": "function",
        "z": "tab_demo_chain",
        "name": "→ /api/td/insert body",
        "func": (
            "const raw = Number(msg.payload);\n"
            "// Add some noise so EMA actually does something\n"
            "const noise = (Math.random() - 0.5) * 0.4;\n"
            "msg.payload = { device: 'plc1', tag: 'temp', value: raw + noise };\n"
            "return msg;"
        ),
        "outputs": 1, "noerr": 0, "x": 320, "y": 140,
        "wires": [["demo_sf_dedupe"]],
    })

    # 3) sf_dedupe — drop consecutive duplicates
    add({
        "id": "demo_sf_dedupe", "type": "subflow:sf_dedupe", "z": "tab_demo_chain",
        "name": "去重",
        "env": [{"name": "KEY", "value": "payload.value", "type": "str"}],
        "x": 540, "y": 140, "wires": [["demo_sf_ema"]],
    })

    # 4) sf_ema — smooth
    add({
        "id": "demo_sf_ema", "type": "subflow:sf_ema", "z": "tab_demo_chain",
        "name": "EMA 平滑",
        "env": [
            {"name": "ALPHA", "value": "0.3", "type": "num"},
            {"name": "VALUE_FIELD", "value": "payload.value", "type": "str"},
        ],
        "x": 740, "y": 140, "wires": [["demo_sf_batch"]],
    })

    # 5) sf_batch — accumulate, flush every 5s or 5 messages
    add({
        "id": "demo_sf_batch", "type": "subflow:sf_batch", "z": "tab_demo_chain",
        "name": "攒批 (5条/5s)",
        "env": [
            {"name": "BATCH_SIZE", "value": "5", "type": "num"},
            {"name": "FLUSH_MS", "value": "5000", "type": "num"},
        ],
        "x": 940, "y": 140, "wires": [["demo_http"]],
    })

    # 6) function — turn batched array into one POST body (use the EMA result)
    add({
        "id": "demo_fn_unwrap",
        "type": "function",
        "z": "tab_demo_chain",
        "name": "unwrap batch → 单条",
        "func": (
            "// sf_batch 输出 payload 是数组;每条单独 POST\n"
            "if (!Array.isArray(msg.payload) || msg.payload.length === 0) return null;\n"
            "const last = msg.payload[msg.payload.length - 1];\n"
            "msg.payload = last;\n"
            "return msg;"
        ),
        "outputs": 1, "noerr": 0, "x": 1120, "y": 140, "wires": [["demo_http"]],
    })

    # 7) http request — POST to gateway /api/td/insert
    add({
        "id": "demo_http", "type": "http request", "z": "tab_demo_chain",
        "name": "POST /api/td/insert",
        "method": "POST", "ret": "obj", "paytoqs": "ignore",
        "url": "http://127.0.0.1:8766/api/td/insert",
        "tls": "", "persist": False, "proxy": "",
        "authType": "", "headers": [],
        "x": 1340, "y": 140, "wires": [["demo_dbg"]],
    })

    # 8) debug — show response
    add({
        "id": "demo_dbg", "type": "debug", "z": "tab_demo_chain",
        "name": "← gateway resp",
        "active": True, "tosidebar": True, "console": False, "tostatus": False,
        "complete": "payload", "targetType": "msg",
        "x": 1540, "y": 140, "wires": [],
    })

    return nodes


def assemble_flows(subflows: list[dict], gateway_api_url: str) -> list[dict]:
    """Combine: 23 subflow defs + bootstrap tab + demo tab."""
    flows: list[dict] = []

    # 1) all subflow definitions
    flows.extend(subflows)

    # 2) bootstrap tab (from nodered_runtime — same one the runtime seeds)
    flows.extend(_bootstrap_flow(gateway_api_url))

    # 3) demo tab + its 8 wiring nodes
    flows.append(_demo_tab())
    flows.extend(build_demo_flow_nodes())

    return flows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--user-dir", default=str(Path.home() / ".1052os" / "node-red"),
        help="Node-RED userDir (must contain settings.js + flows.json)",
    )
    ap.add_argument(
        "--gateway", default="http://127.0.0.1:8766",
        help="gateway API base URL (used in /api/td/insert POST target)",
    )
    args = ap.parse_args()

    user_dir = Path(args.user_dir)
    user_dir.mkdir(parents=True, exist_ok=True)

    print(f"[seed] extracting subflows from {len(SOURCE_FILES)} source files...")
    subflows = extract_subflows(SOURCE_FILES)
    ids = {s["id"] for s in subflows}
    missing = EXPECTED_SUBFLOWS - ids
    extra = ids - EXPECTED_SUBFLOWS
    print(f"[seed] found {len(subflows)} subflow definitions "
          f"(expected {len(EXPECTED_SUBFLOWS)})")
    if missing:
        print(f"[seed] MISSING ids: {sorted(missing)}", file=sys.stderr)
    if extra:
        print(f"[seed] extra ids: {sorted(extra)} (ok if documented)", file=sys.stderr)

    flows = assemble_flows(subflows, args.gateway)

    # Backfill: rewrite every http request URL pointing at the default
    # gateway URL so a re-seed with --gateway works without touching the
    # markdown sources.
    for n in flows:
        if n.get("type") == "http request" and "url" in n:
            if "127.0.0.1:8766" in n["url"]:
                n["url"] = n["url"].replace(
                    "http://127.0.0.1:8766", args.gateway.rstrip("/")
                )

    out = user_dir / "flows.json"
    out.write_text(json.dumps(flows, indent=2, ensure_ascii=False))
    print(f"[seed] wrote {out} ({len(flows)} nodes, "
          f"{out.stat().st_size // 1024} KB)")

    if missing:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
