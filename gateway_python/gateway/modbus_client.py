"""
1052-OS Industrial Gateway — Modbus Protocol Client
Supports Modbus TCP and RTU (serial).
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from pymodbus.client import ModbusTcpClient, ModbusSerialClient


class ModbusMode(str, Enum):
    TCP = "tcp"
    RTU = "rtu"


@dataclass
class ModbusConfig:
    mode: ModbusMode = ModbusMode.TCP
    # TCP
    host: str = "127.0.0.1"
    port: int = 502
    # RTU
    serial_port: str = "/dev/ttyUSB0"
    baudrate: int = 9600
    parity: str = "N"  # N, E, O
    stopbits: int = 1
    bytesize: int = 8
    # Common
    unit_id: int = 1
    timeout: float = 3.0

    def to_dict(self) -> dict:
        return {
            "mode": self.mode.value,
            "host": self.host,
            "port": self.port,
            "serial_port": self.serial_port,
            "baudrate": self.baudrate,
            "parity": self.parity,
            "stopbits": self.stopbits,
            "bytesize": self.bytesize,
            "unit_id": self.unit_id,
            "timeout": self.timeout,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ModbusConfig":
        return cls(
            mode=ModbusMode(d.get("mode", "tcp")),
            host=d.get("host", "127.0.0.1"),
            port=d.get("port", 502),
            serial_port=d.get("serial_port", "/dev/ttyUSB0"),
            baudrate=d.get("baudrate", 9600),
            parity=d.get("parity", "N"),
            stopbits=d.get("stopbits", 1),
            bytesize=d.get("bytesize", 8),
            unit_id=d.get("unit_id", 1),
            timeout=d.get("timeout", 3.0),
        )


class ModbusClient:
    """Unified Modbus TCP/RTU client with context manager support."""

    def __init__(self, config: ModbusConfig | None = None):
        self.config = config or ModbusConfig()
        self._client: ModbusTcpClient | ModbusSerialClient | None = None

    def connect(self) -> bool:
        """Open connection. Returns True on success."""
        if self.config.mode == ModbusMode.TCP:
            self._client = ModbusTcpClient(
                self.config.host,
                port=self.config.port,
                timeout=self.config.timeout,
            )
        else:
            self._client = ModbusSerialClient(
                port=self.config.serial_port,
                baudrate=self.config.baudrate,
                parity=self.config.parity,
                stopbits=self.config.stopbits,
                bytesize=self.config.bytesize,
                timeout=self.config.timeout,
            )
        return self._client.connect()

    def disconnect(self):
        if self._client:
            self._client.close()

    @property
    def connected(self) -> bool:
        return self._client is not None and self._client.connected

    def _ensure_connected(self):
        if not self.connected:
            raise ConnectionError("Modbus client not connected")

    # ── Read ────────────────────────────────────────────

    def read_coils(self, address: int, count: int = 1) -> list[bool]:
        """FC1: Read coils (0x)."""
        self._ensure_connected()
        result = self._client.read_coils(address, count=count, device_id=self.config.unit_id)
        if result.isError():
            raise IOError(f"FC1 read_coils failed: {result}")
        return result.bits[:count]

    def read_discrete_inputs(self, address: int, count: int = 1) -> list[bool]:
        """FC2: Read discrete inputs (1x)."""
        self._ensure_connected()
        result = self._client.read_discrete_inputs(address, count=count, device_id=self.config.unit_id)
        if result.isError():
            raise IOError(f"FC2 read_discrete_inputs failed: {result}")
        return result.bits[:count]

    def read_holding_registers(self, address: int, count: int = 1) -> list[int]:
        """FC3: Read holding registers (4x)."""
        self._ensure_connected()
        result = self._client.read_holding_registers(address, count=count, device_id=self.config.unit_id)
        if result.isError():
            raise IOError(f"FC3 read_holding_registers failed: {result}")
        return result.registers[:count]

    def read_input_registers(self, address: int, count: int = 1) -> list[int]:
        """FC4: Read input registers (3x)."""
        self._ensure_connected()
        result = self._client.read_input_registers(address, count=count, device_id=self.config.unit_id)
        if result.isError():
            raise IOError(f"FC4 read_input_registers failed: {result}")
        return result.registers[:count]

    # ── Write ───────────────────────────────────────────

    def write_coil(self, address: int, value: bool):
        """FC5: Write single coil."""
        self._ensure_connected()
        result = self._client.write_coil(address, value, device_id=self.config.unit_id)
        if result.isError():
            raise IOError(f"FC5 write_coil failed: {result}")

    def write_register(self, address: int, value: int):
        """FC6: Write single register."""
        self._ensure_connected()
        result = self._client.write_register(address, value, device_id=self.config.unit_id)
        if result.isError():
            raise IOError(f"FC6 write_register failed: {result}")

    def write_coils(self, address: int, values: list[bool]):
        """FC15: Write multiple coils."""
        self._ensure_connected()
        result = self._client.write_coils(address, values, device_id=self.config.unit_id)
        if result.isError():
            raise IOError(f"FC15 write_coils failed: {result}")

    def write_registers(self, address: int, values: list[int]):
        """FC16: Write multiple registers."""
        self._ensure_connected()
        result = self._client.write_registers(address, values, device_id=self.config.unit_id)
        if result.isError():
            raise IOError(f"FC16 write_registers failed: {result}")

    # ── High-level helpers ─────────────────────────────

    def read_float32(self, address: int) -> float:
        """Read 2 consecutive holding registers as IEEE 754 float32 (big-endian word order)."""
        words = self.read_holding_registers(address, 2)
        import struct
        raw = struct.pack(">HH", words[0], words[1])
        return struct.unpack(">f", raw)[0]

    def write_float32(self, address: int, value: float):
        """Write IEEE 754 float32 to 2 consecutive holding registers."""
        import struct
        raw = struct.pack(">f", value)
        hi, lo = struct.unpack(">HH", raw)
        self.write_registers(address, [hi, lo])

    def scan_registers(self, start: int, count: int) -> dict[str, Any]:
        """Quick scan: read a block of holding registers and return address→value map."""
        values = self.read_holding_registers(start, count)
        return {start + i: v for i, v in enumerate(values)}

    def ping(self) -> dict[str, Any]:
        """Lightweight connectivity check."""
        try:
            self._ensure_connected()
            # Try reading a single holding register at address 0
            try:
                self.read_holding_registers(0, 1)
                return {"ok": True, "message": "connected + read OK"}
            except IOError:
                return {"ok": True, "message": "connected (read timeout — device may be offline)"}
        except ConnectionError as e:
            return {"ok": False, "message": str(e)}

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *args):
        self.disconnect()
