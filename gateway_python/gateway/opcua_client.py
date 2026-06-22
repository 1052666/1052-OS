"""
1052-OS Industrial Gateway — OPC UA Protocol Client
"""

from dataclasses import dataclass, field
from typing import Any

from asyncua import Client as OpcuaClient


@dataclass
class OpcuaConfig:
    url: str = "opc.tcp://127.0.0.1:4840"
    timeout: float = 5.0
    username: str | None = None
    password: str | None = None

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "timeout": self.timeout,
            "username": self.username,
            "password": "***" if self.password else None,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "OpcuaConfig":
        return cls(
            url=d.get("url", "opc.tcp://127.0.0.1:4840"),
            timeout=d.get("timeout", 5.0),
            username=d.get("username"),
            password=d.get("password"),
        )


class OpcuaClientWrapper:
    """OPC UA client wrapper with context manager support."""

    def __init__(self, config: OpcuaConfig | None = None):
        self.config = config or OpcuaConfig()
        self._client: OpcuaClient | None = None

    async def connect(self) -> bool:
        self._client = OpcuaClient(url=self.config.url, timeout=self.config.timeout)
        if self.config.username:
            self._client.set_user(self.config.username)
        if self.config.password:
            self._client.set_password(self.config.password)
        await self._client.connect()
        return True

    async def disconnect(self):
        if self._client:
            await self._client.disconnect()

    @property
    def connected(self) -> bool:
        return self._client is not None

    # ── Browse ────────────────────────────────────────

    async def browse_children(self, node_id: str | None = None) -> list[dict]:
        """Browse child nodes. If node_id is None, browses root Objects folder."""
        if node_id is None:
            node = self._client.get_objects_node()
        else:
            node = self._client.get_node(node_id)

        children = await node.get_children()
        result = []
        for child in children:
            display = await child.read_display_name()
            node_class = await child.read_node_class()
            try:
                dtype = await child.read_data_type_as_variant_type()
            except Exception:
                dtype = None
            result.append({
                "node_id": child.nodeid.to_string(),
                "display_name": display.Text,
                "node_class": node_class.name if node_class else "Unknown",
                "data_type": dtype.name if dtype else None,
            })
        return result

    # ── Read ───────────────────────────────────────────

    async def read_node(self, node_id: str) -> dict[str, Any]:
        """Read a single node by its NodeId string (e.g. ns=2;s=Temperature)."""
        node = self._client.get_node(node_id)
        value = await node.read_value()
        dtype = await node.read_data_type_as_variant_type()
        display = await node.read_display_name()
        return {
            "node_id": node_id,
            "display_name": display.Text,
            "value": value,
            "data_type": dtype.name if dtype else "Unknown",
        }

    async def read_nodes(self, node_ids: list[str]) -> list[dict[str, Any]]:
        """Batch read multiple nodes."""
        nodes = [self._client.get_node(nid) for nid in node_ids]
        values = await self._client.read_values(nodes)
        results = []
        for node, val in zip(nodes, values):
            display = await node.read_display_name()
            try:
                dtype = await node.read_data_type_as_variant_type()
            except Exception:
                dtype = None
            results.append({
                "node_id": node.nodeid.to_string(),
                "display_name": display.Text,
                "value": val,
                "data_type": dtype.name if dtype else "Unknown",
            })
        return results

    # ── Write ──────────────────────────────────────────

    async def write_node(self, node_id: str, value: Any):
        """Write a value to a node."""
        node = self._client.get_node(node_id)
        dv = await node.read_data_value()
        dv.Value.Value = value
        await node.set_value(dv)

    # ── Browse tree ────────────────────────────────────

    async def browse_tree(self, node_id: str | None = None, depth: int = 2) -> dict:
        """Recursively browse a node tree up to given depth."""
        if node_id is None:
            node = self._client.get_objects_node()
        else:
            node = self._client.get_node(node_id)

        display = await node.read_display_name()
        children_info = []
        if depth > 0:
            for child in await node.get_children():
                child_info = await self.browse_tree(child.nodeid.to_string(), depth - 1)
                children_info.append(child_info)

        return {
            "node_id": node.nodeid.to_string(),
            "display_name": display.Text,
            "children": children_info if children_info else None,
        }

    async def ping(self) -> dict:
        """Lightweight connectivity check."""
        try:
            if not self._client:
                return {"ok": False, "message": "Not connected"}
            # Try reading server status
            server_node = self._client.get_node("i=2256")  # Server_ServerStatus
            val = await server_node.read_value()
            return {"ok": True, "message": "connected", "server_status": str(val)}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, *args):
        await self.disconnect()
