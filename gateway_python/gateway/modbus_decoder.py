"""
1052-OS Industrial Gateway — Modbus Data Type Decoder

Decodes raw 16-bit Modbus register words into typed values.

Supports:
  - Integer: u8/i8/u16/i16/u32/i32/u64/i64
  - Float:   f32 / f64 (IEEE 754)
  - BCD:     bcd16 / bcd32 (binary-coded decimal)
  - Bit:     bit (one bit of one register, 0..15)
  - String:  ascii:N / utf8:N (N chars = ceil(N/2) registers)
  - Special: time (epoch seconds from 2 registers) / duration (ms from 2 reg as f32)

Byte orders (endian):
  - ABCD: big-endian (Modbus default).        A B C D
  - CDAB: byte-swap within each word.         B A D C
  - BADC: word-swap (two words reversed).    C D A B
  - DCBA: full reverse.                       D C B A
"""

from __future__ import annotations

import struct
from typing import Iterable, Union

# ── Public constants ──────────────────────────────────────────

ENDIANS: tuple[str, ...] = ("ABCD", "CDAB", "BADC", "DCBA")
DEFAULT_ENDIAN: str = "ABCD"

# 16 types — keep this list in sync with the frontend MB_HEADERS
DTYPES: tuple[str, ...] = (
    "u8", "i8", "u16", "i16", "u32", "i32", "u64", "i64",
    "f32", "f64", "bcd16", "bcd32", "bit",
    "ascii", "utf8", "time", "duration",
)

# Register footprint per dtype (1 register = 16 bits)
REGISTER_FOOTPRINT: dict[str, int] = {
    "u8": 1, "i8": 1,
    "u16": 1, "i16": 1,
    "u32": 2, "i32": 2,
    "u64": 4, "i64": 4,
    "f32": 2, "f64": 4,
    "bcd16": 1, "bcd32": 2,
    "bit": 1,  # single bit lives in 1 register
    "ascii": 1, "utf8": 1,  # base unit, multiplied by N in calc_string_words
    "time": 2, "duration": 2,
}

# ── Errors ────────────────────────────────────────────────────


class DecoderError(ValueError):
    """Raised when a dtype/endian/word combination cannot be decoded."""


# ── Byte-order helpers ────────────────────────────────────────


def words_to_bytes(words: list[int], endian: str) -> bytes:
    """Convert a list of 16-bit words to bytes using the given endian pattern.

    ABCD: words[0] hi, words[0] lo, words[1] hi, words[1] lo
    CDAB: words[0] lo, words[0] hi, words[1] lo, words[1] hi
    BADC: words[1] hi, words[1] lo, words[0] hi, words[0] lo
    DCBA: words[1] lo, words[1] hi, words[0] lo, words[0] hi
    """
    if endian not in ENDIANS:
        raise DecoderError(f"unknown endian: {endian} (expected one of {ENDIANS})")
    if not words:
        return b""

    # Reorder words first
    if endian == "BADC" or endian == "DCBA":
        w = list(reversed(words))
    else:
        w = list(words)

    # Then optionally swap bytes within each word
    swap_bytes = endian in ("CDAB", "DCBA")
    out = bytearray()
    for word in w:
        hi = (word >> 8) & 0xFF
        lo = word & 0xFF
        if swap_bytes:
            out.append(lo)
            out.append(hi)
        else:
            out.append(hi)
            out.append(lo)
    return bytes(out)


# ── Dtype decoders (operate on bytes / words) ────────────────


def _decode_unsigned(b: bytes, size: int) -> int:
    return int.from_bytes(b, "big", signed=False) if size > 0 else 0


def _decode_signed(b: bytes, size: int) -> int:
    return int.from_bytes(b, "big", signed=True) if size > 0 else 0


def _decode_bcd(words: list[int], endian: str) -> int:
    """Decode BCD (binary-coded decimal). Each nibble is 0-9."""
    b = words_to_bytes(words, endian)
    out = 0
    for byte in b:
        hi = (byte >> 4) & 0x0F
        lo = byte & 0x0F
        if hi > 9 or lo > 9:
            raise DecoderError(f"invalid BCD digit in byte 0x{byte:02x}")
        out = out * 100 + hi * 10 + lo
    return out


def _decode_string(words: list[int], endian: str, encoding: str = "ascii") -> str:
    raw = words_to_bytes(words, endian)
    # Decode, drop trailing NULs
    return raw.decode(encoding, errors="replace").rstrip("\x00").rstrip()


# ── Public API ────────────────────────────────────────────────


def register_count(dtype: str, string_len: int = 1) -> int:
    """How many 16-bit registers a single decoded value of `dtype` occupies.

    For string types, pass `string_len` = N (number of characters).
    """
    if dtype not in DTYPES:
        raise DecoderError(f"unknown dtype: {dtype}")
    if dtype in ("ascii", "utf8"):
        if string_len <= 0:
            raise DecoderError("string length must be > 0")
        # N chars = ceil(N / 2) registers
        return (string_len + 1) // 2
    return REGISTER_FOOTPRINT[dtype]


def decode_value(
    words: list[int],
    dtype: str,
    endian: str = DEFAULT_ENDIAN,
    *,
    bit_index: int = 0,
    string_len: int = 1,
) -> Union[int, float, bool, str]:
    """Decode a list of words into a typed value.

    Args:
      words: list of 16-bit unsigned ints (raw Modbus registers)
      dtype: one of DTYPES
      endian: ABCD | CDAB | BADC | DCBA
      bit_index: 0..15, only for dtype='bit'
      string_len: number of characters, only for dtype='ascii' / 'utf8'

    Returns:
      decoded value (int | float | bool | str)

    Raises:
      DecoderError on bad dtype/endian/missing data.
    """
    if dtype not in DTYPES:
        raise DecoderError(f"unknown dtype: {dtype}")
    if endian not in ENDIANS:
        raise DecoderError(f"unknown endian: {endian}")

    # Per-dtype required word count
    if dtype in ("ascii", "utf8"):
        need = register_count(dtype, string_len)
    else:
        need = register_count(dtype)
    if len(words) < need:
        raise DecoderError(
            f"dtype {dtype} needs {need} word(s), got {len(words)}"
        )

    if dtype == "u8":
        # Use the LOW byte of words[0] (Modbus convention for u8)
        return words[0] & 0xFF

    if dtype == "i8":
        val = words[0] & 0xFF
        return val - 256 if val >= 128 else val

    if dtype == "u16":
        return words[0] & 0xFFFF

    if dtype == "i16":
        val = words[0] & 0xFFFF
        return val - 0x10000 if val >= 0x8000 else val

    if dtype in ("u32", "i32"):
        b = words_to_bytes(words[:2], endian)
        if dtype == "u32":
            return _decode_unsigned(b, 4)
        return _decode_signed(b, 4)

    if dtype in ("u64", "i64"):
        b = words_to_bytes(words[:4], endian)
        if dtype == "u64":
            return _decode_unsigned(b, 8)
        return _decode_signed(b, 8)

    if dtype == "f32":
        b = words_to_bytes(words[:2], endian)
        return struct.unpack(">f", b)[0]

    if dtype == "f64":
        b = words_to_bytes(words[:4], endian)
        return struct.unpack(">d", b)[0]

    if dtype == "bcd16":
        return _decode_bcd(words[:1], endian)

    if dtype == "bcd32":
        return _decode_bcd(words[:2], endian)

    if dtype == "bit":
        if not 0 <= bit_index <= 15:
            raise DecoderError(f"bit_index must be 0..15, got {bit_index}")
        return bool((words[0] >> bit_index) & 1)

    if dtype == "ascii":
        return _decode_string(words[:register_count("ascii", string_len)], endian, "ascii")

    if dtype == "utf8":
        return _decode_string(words[:register_count("utf8", string_len)], endian, "utf-8")

    if dtype == "time":
        # 2 registers as big-endian u32 = epoch seconds (independent of endian on purpose
        # — time fields are conventionally big-endian, but allow override)
        b = words_to_bytes(words[:2], endian)
        return _decode_unsigned(b, 4)

    if dtype == "duration":
        # 2 registers as f32 = milliseconds
        b = words_to_bytes(words[:2], endian)
        return struct.unpack(">f", b)[0]

    # Unreachable; keeps type-checker happy
    raise DecoderError(f"unhandled dtype: {dtype}")


def encode_value(
    value: Union[int, float, bool, str],
    dtype: str,
    endian: str = DEFAULT_ENDIAN,
    *,
    string_len: int = 1,
) -> list[int]:
    """Encode a typed value back to a list of 16-bit words (for writes)."""
    if endian not in ENDIANS:
        raise DecoderError(f"unknown endian: {endian}")
    if dtype not in DTYPES:
        raise DecoderError(f"unknown dtype: {dtype}")

    if dtype in ("u8", "i8", "u16", "i16", "bit"):
        v = int(bool(value)) if dtype == "bit" else int(value)
        if dtype == "u8":
            v &= 0xFF
        elif dtype == "i8":
            v = v & 0xFF
            if v >= 128: v -= 256
        elif dtype == "u16":
            v &= 0xFFFF
        elif dtype == "i16":
            v = v & 0xFFFF
            if v >= 0x8000: v -= 0x10000
        return [v & 0xFFFF]

    if dtype in ("u32", "i32"):
        b = int(value).to_bytes(4, "big", signed=(dtype == "i32"))
        return list(_bytes_to_words(b, endian))

    if dtype in ("u64", "i64"):
        b = int(value).to_bytes(8, "big", signed=(dtype == "i64"))
        return list(_bytes_to_words(b, endian))

    if dtype == "f32":
        b = struct.pack(">f", float(value))
        return list(_bytes_to_words(b, endian))

    if dtype == "f64":
        b = struct.pack(">d", float(value))
        return list(_bytes_to_words(b, endian))

    if dtype in ("bcd16", "bcd32"):
        n = int(value)
        size = 4 if dtype == "bcd16" else 8
        s = str(abs(n)).zfill(size // 4)
        b = bytearray()
        for i in range(0, len(s), 2):
            b.append(int(s[i]) * 16 + int(s[i + 1]))
        return list(_bytes_to_words(bytes(b), endian))

    if dtype in ("ascii", "utf8"):
        enc = "ascii" if dtype == "ascii" else "utf-8"
        raw = str(value).encode(enc, errors="replace")
        need = register_count(dtype, string_len) * 2
        raw = raw[:need].ljust(need, b"\x00")
        return list(_bytes_to_words(raw, endian))

    if dtype == "time":
        b = int(value).to_bytes(4, "big", signed=False)
        return list(_bytes_to_words(b, endian))

    if dtype == "duration":
        b = struct.pack(">f", float(value))
        return list(_bytes_to_words(b, endian))

    raise DecoderError(f"unhandled dtype: {dtype}")


def _bytes_to_words(b: bytes, endian: str) -> list[int]:
    """Inverse of words_to_bytes — pack bytes into 16-bit words.

    Big-endian bytes come in; we split into 2-byte words, optionally
    byte-swap each word, then optionally reverse the word list.
    """
    if len(b) % 2 == 1:
        b = b + b"\x00"
    swap_bytes = endian in ("CDAB", "DCBA")
    reverse_words = endian in ("BADC", "DCBA")
    words: list[int] = []
    for i in range(0, len(b), 2):
        hi, lo = b[i], b[i + 1]
        if swap_bytes:
            hi, lo = lo, hi
        words.append((hi << 8) | lo)
    if reverse_words:
        words.reverse()
    return words


# ── Catalog (for the UI's "数据类型参考" sheet) ──────────────


def dtype_catalog() -> list[dict[str, str]]:
    """Return a description table for UI display."""
    return [
        {"dtype": "u8",    "category": "unsigned int", "size_bytes": "1",  "words": "1",  "desc": "无符号 8 位（低字节）"},
        {"dtype": "u16",   "category": "unsigned int", "size_bytes": "2",  "words": "1",  "desc": "无符号 16 位（Modbus 原生）"},
        {"dtype": "u32",   "category": "unsigned int", "size_bytes": "4",  "words": "2",  "desc": "无符号 32 位"},
        {"dtype": "u64",   "category": "unsigned int", "size_bytes": "8",  "words": "4",  "desc": "无符号 64 位"},
        {"dtype": "i8",    "category": "signed int",   "size_bytes": "1",  "words": "1",  "desc": "有符号 8 位（补码）"},
        {"dtype": "i16",   "category": "signed int",   "size_bytes": "2",  "words": "1",  "desc": "有符号 16 位"},
        {"dtype": "i32",   "category": "signed int",   "size_bytes": "4",  "words": "2",  "desc": "有符号 32 位"},
        {"dtype": "i64",   "category": "signed int",   "size_bytes": "8",  "words": "4",  "desc": "有符号 64 位"},
        {"dtype": "f32",   "category": "float",        "size_bytes": "4",  "words": "2",  "desc": "IEEE 754 单精度浮点"},
        {"dtype": "f64",   "category": "float",        "size_bytes": "8",  "words": "4",  "desc": "IEEE 754 双精度浮点"},
        {"dtype": "bcd16", "category": "bcd",          "size_bytes": "2",  "words": "1",  "desc": "BCD 16 位（0-9999）"},
        {"dtype": "bcd32", "category": "bcd",          "size_bytes": "4",  "words": "2",  "desc": "BCD 32 位（0-99999999）"},
        {"dtype": "bit",   "category": "bit",          "size_bytes": "0.2","words": "1",  "desc": "取某寄存器的某一位（0..15）"},
        {"dtype": "ascii", "category": "string",       "size_bytes": "N",  "words": "N/2","desc": "ASCII 字符串，N 字符占 ceil(N/2) 寄存"},
        {"dtype": "utf8",  "category": "string",       "size_bytes": "N",  "words": "N/2","desc": "UTF-8 字符串"},
        {"dtype": "time",  "category": "time",         "size_bytes": "4",  "words": "2",  "desc": "epoch 秒（u32）"},
        {"dtype": "duration","category": "time",       "size_bytes": "4",  "words": "2",  "desc": "持续时间（f32 毫秒）"},
    ]


def endian_catalog() -> list[dict[str, str]]:
    return [
        {"endian": "ABCD", "name": "Big-endian",       "desc": "标准 Modbus 大端；字节序 AB CD"},
        {"endian": "CDAB", "name": "Byte-swap",        "desc": "字内字节交换；Modicon legacy 等"},
        {"endian": "BADC", "name": "Word-swap",        "desc": "两个字交换；AB/罗克韦尔 PLC 等"},
        {"endian": "DCBA", "name": "Full reverse",     "desc": "完全反转；西门子 S7 部分寄存器等"},
    ]
