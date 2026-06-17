"""
1052-OS Industrial Gateway — Node-RED tag catalog
Builds a discoverable list of all collector tasks with MQTT topic info.
"""
from typing import Iterable


def build_tag_catalog(tasks: dict) -> list[dict]:
    """Convert collector tasks dict to a tag list suitable for /api/tags."""
    out = []
    for tid, task in sorted(tasks.items()):
        device = getattr(task, "device", "") or getattr(task, "table", "raw_data")
        site = getattr(task, "site", "default")
        out.append({
            "tag": tid,
            "site": site,
            "device": device,
            "protocol": task.protocol,
            "table": task.table,
            "dtype": task.dtype,
            "endian": task.endian,
            "interval": task.interval,
            "ua_node_id": getattr(task, "ua_node_id", ""),
            "topic": f"1052os/{site}/{device}/{tid}/value",
            "meta_topic": f"1052os/{site}/{device}/{tid}/meta",
        })
    return out
