"""1052-OS Industrial Gateway — Node-RED Command Handler

Subscribes to 1052os/cmd/write/{modbus,opcua} and dispatches to the underlying
write primitives. Audits every attempt (success or failure) via
WriteAuditLogger.

Wire format (modbus):
    {"request_id": "...", "cmd": "write_coil",
     "host": "127.0.0.1", "port": 502, "unit_id": 1,
     "address": 0, "value": true}

Wire format (opcua):
    {"request_id": "...", "cmd": "write_node",
     "url": "opc.tcp://127.0.0.1:4840", "node_id": "ns=2;s=Tag1",
     "value": 42.0}

Supported modbus cmd values:
    write_coil, write_register, write_coils, write_registers, write_float32
"""
import asyncio
import json
import logging
import uuid

log = logging.getLogger("gateway.command_handler")

SUPPORTED_MODBUS_CMDS = {
    "write_coil",
    "write_register",
    "write_coils",
    "write_registers",
    "write_float32",
}


class CommandHandler:
    """MQTT subscriber that converts Node-RED command messages into writes.

    Uses paho's message_callback_add to attach topic-specific handlers
    without disturbing any other callback on the shared MqttClientWrapper.
    """

    def __init__(self, mqtt_client, audit):
        self.mqtt_client = mqtt_client
        self.audit = audit

    # ── Lifecycle ──────────────────────────────────────

    def start(self):
        """Subscribe to command topics and register per-topic handlers."""
        if self.mqtt_client is None:
            return
        # Subscribe first so the broker starts forwarding messages.
        try:
            self.mqtt_client.subscribe("1052os/cmd/write/modbus")
            self.mqtt_client.subscribe("1052os/cmd/write/opcua")
        except Exception as e:
            log.warning(f"CommandHandler.subscribe failed: {e}")
        # Register per-topic callbacks on the underlying paho client.
        paho_client = getattr(self.mqtt_client, "_client", None)
        if paho_client is not None:
            try:
                paho_client.message_callback_add(
                    "1052os/cmd/write/modbus", self._on_modbus_paho_msg
                )
                paho_client.message_callback_add(
                    "1052os/cmd/write/opcua", self._on_opcua_paho_msg
                )
            except Exception as e:
                log.warning(f"CommandHandler.message_callback_add failed: {e}")

    # ── Modbus ────────────────────────────────────────

    def _on_modbus_paho_msg(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode("utf-8", errors="replace"))
        except Exception as e:
            log.warning(f"CommandHandler: invalid JSON on modbus cmd: {e}")
            return

        request_id = str(payload.get("request_id") or uuid.uuid4().hex)
        cmd = payload.get("cmd", "")
        host = payload.get("host", "127.0.0.1")
        port = int(payload.get("port", 502))
        unit_id = int(payload.get("unit_id", 1))
        address = payload.get("address", "?")
        target = f"{host}:{port}/u{unit_id}/{address}"

        if cmd not in SUPPORTED_MODBUS_CMDS:
            log.warning(f"CommandHandler: unknown modbus cmd '{cmd}'")
            self.audit.log(
                request_id=request_id, source="nodered",
                protocol="modbus", target=target, cmd=cmd or "?",
                value=None, result="error", error=f"unknown cmd '{cmd}'",
            )
            return

        try:
            mc = self._make_modbus_client(host, port, unit_id)
            with mc as client_obj:
                self._call_modbus(client_obj, cmd, payload)
            self.audit.log(
                request_id=request_id, source="nodered",
                protocol="modbus", target=target, cmd=cmd,
                value=payload.get("value"), result="ok",
            )
        except Exception as e:
            log.warning(f"CommandHandler: modbus {cmd} failed: {e}")
            self.audit.log(
                request_id=request_id, source="nodered",
                protocol="modbus", target=target, cmd=cmd,
                value=payload.get("value"), result="error", error=str(e),
            )

    def _make_modbus_client(self, host: str, port: int, unit_id: int):
        """Construct a ModbusClient. Override in tests to inject a fake."""
        from gateway.modbus_client import ModbusClient, ModbusConfig
        return ModbusClient(ModbusConfig(host=host, port=port, unit_id=unit_id))

    @staticmethod
    def _call_modbus(mc, cmd: str, payload: dict):
        if cmd == "write_coil":
            mc.write_coil(payload["address"], payload["value"])
        elif cmd == "write_register":
            mc.write_register(payload["address"], payload["value"])
        elif cmd == "write_coils":
            mc.write_coils(payload["address"], payload["values"])
        elif cmd == "write_registers":
            mc.write_registers(payload["address"], payload["values"])
        elif cmd == "write_float32":
            mc.write_float32(payload["address"], payload["value"])

    # ── OPC UA ────────────────────────────────────────

    def _on_opcua_paho_msg(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode("utf-8", errors="replace"))
        except Exception as e:
            log.warning(f"CommandHandler: invalid JSON on opcua cmd: {e}")
            return

        request_id = str(payload.get("request_id") or uuid.uuid4().hex)
        cmd = payload.get("cmd", "")
        url = payload.get("url", "opc.tcp://127.0.0.1:4840")
        node_id = payload.get("node_id", "")
        value = payload.get("value")
        target = f"{url}/{node_id}"

        if cmd != "write_node":
            log.warning(f"CommandHandler: unknown opcua cmd '{cmd}'")
            self.audit.log(
                request_id=request_id, source="nodered",
                protocol="opcua", target=target, cmd=cmd or "?",
                value=None, result="error", error=f"unknown cmd '{cmd}'",
            )
            return

        try:
            oc = self._make_opcua_client(url)
            asyncio.run(self._call_opcua(oc, node_id, value))
            self.audit.log(
                request_id=request_id, source="nodered",
                protocol="opcua", target=target, cmd=cmd,
                value=value, result="ok",
            )
        except Exception as e:
            log.warning(f"CommandHandler: opcua {cmd} failed: {e}")
            self.audit.log(
                request_id=request_id, source="nodered",
                protocol="opcua", target=target, cmd=cmd,
                value=value, result="error", error=str(e),
            )

    def _make_opcua_client(self, url: str):
        """Construct an OpcuaClientWrapper. Override in tests to inject a fake."""
        from gateway.opcua_client import OpcuaClientWrapper, OpcuaConfig
        return OpcuaClientWrapper(OpcuaConfig(url=url))

    @staticmethod
    async def _call_opcua(oc, node_id: str, value):
        await oc.connect()
        try:
            await oc.write_node(node_id, value)
        finally:
            try:
                await oc.disconnect()
            except Exception:
                pass
