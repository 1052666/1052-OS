"""Unit tests for modbus_decoder — no server required."""
import math
import sys
from pathlib import Path

# Make `gateway` importable
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.modbus_decoder import (  # noqa: E402
    DecoderError, DTYPES, ENDIANS, decode_value, encode_value,
    dtype_catalog, endian_catalog, register_count, words_to_bytes,
)


# ── words_to_bytes ────────────────────────────────────────────


def test_words_to_bytes_abcd():
    assert words_to_bytes([0x1234, 0x5678], "ABCD") == bytes([0x12, 0x34, 0x56, 0x78])


def test_words_to_bytes_cdab():
    assert words_to_bytes([0x1234, 0x5678], "CDAB") == bytes([0x34, 0x12, 0x78, 0x56])


def test_words_to_bytes_badc():
    assert words_to_bytes([0x1234, 0x5678], "BADC") == bytes([0x56, 0x78, 0x12, 0x34])


def test_words_to_bytes_dcba():
    assert words_to_bytes([0x1234, 0x5678], "DCBA") == bytes([0x78, 0x56, 0x34, 0x12])


def test_words_to_bytes_empty():
    assert words_to_bytes([], "ABCD") == b""


def test_words_to_bytes_bad_endian():
    try:
        words_to_bytes([1], "XYZ")
    except DecoderError:
        return
    raise AssertionError("expected DecoderError")


# ── register_count ────────────────────────────────────────────


def test_register_count_basic():
    assert register_count("u16") == 1
    assert register_count("i16") == 1
    assert register_count("u32") == 2
    assert register_count("i32") == 2
    assert register_count("f32") == 2
    assert register_count("f64") == 4
    assert register_count("u64") == 4
    assert register_count("i64") == 4
    assert register_count("bcd16") == 1
    assert register_count("bcd32") == 2


def test_register_count_string():
    assert register_count("ascii", 4) == 2
    assert register_count("ascii", 5) == 3
    assert register_count("ascii", 1) == 1


def test_register_count_unknown():
    try:
        register_count("xyz")
    except DecoderError:
        return
    raise AssertionError("expected DecoderError")


# ── u8 / i8 ───────────────────────────────────────────────────


def test_u8_low_byte():
    assert decode_value([0x12AB], "u8") == 0xAB


def test_i8_negative():
    # 0xFF = -1
    assert decode_value([0x00FF], "i8") == -1
    assert decode_value([0x0080], "i8") == -128
    assert decode_value([0x007F], "i8") == 127


# ── u16 / i16 ─────────────────────────────────────────────────


def test_u16_basic():
    assert decode_value([0x1234], "u16") == 0x1234


def test_i16_negative():
    assert decode_value([0xFFFF], "i16") == -1
    assert decode_value([0x8000], "i16") == -32768
    assert decode_value([0x7FFF], "i16") == 32767


# ── u32 / i32 (all 4 endians) ────────────────────────────────


def test_u32_abcd():
    # 0x12345678
    assert decode_value([0x1234, 0x5678], "u32", "ABCD") == 0x12345678


def test_u32_cdab():
    # same word order, bytes swapped within each word → result is same numeric
    # because we're reading two bytes worth into a 32-bit slot.
    # Actually 0x1234 0x5678 in CDAB → 0x34 0x12 0x78 0x56 = 0x34127856
    assert decode_value([0x1234, 0x5678], "u32", "CDAB") == 0x34127856


def test_u32_badc():
    # word swap: 0x5678 0x1234 → 0x56781234
    assert decode_value([0x1234, 0x5678], "u32", "BADC") == 0x56781234


def test_u32_dcba():
    # word + byte swap: 0x78563412
    assert decode_value([0x1234, 0x5678], "u32", "DCBA") == 0x78563412


def test_i32_negative_abcd():
    # 0xFFFFFFFF = -1
    assert decode_value([0xFFFF, 0xFFFF], "i32", "ABCD") == -1


def test_i32_max_abcd():
    assert decode_value([0x7FFF, 0xFFFF], "i32", "ABCD") == 0x7FFFFFFF


# ── u64 / i64 ─────────────────────────────────────────────────


def test_u64_abcd():
    assert decode_value([0x1234, 0x5678, 0x9ABC, 0xDEF0], "u64", "ABCD") == 0x123456789ABCDEF0


def test_i64_negative_abcd():
    assert decode_value([0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF], "i64", "ABCD") == -1


# ── f32 / f64 (IEEE 754) ─────────────────────────────────────


def test_f32_abcd():
    # 3.14 as IEEE 754 = 0x4048F5C3
    val = decode_value([0x4048, 0xF5C3], "f32", "ABCD")
    assert math.isclose(val, 3.14, rel_tol=1e-5)


def test_f32_cdab():
    # byte-swap: 0x4840 0xC3F5 → this is byte-swapped representation
    val = decode_value([0x4048, 0xF5C3], "f32", "CDAB")
    # verify it's NOT 3.14 (proves endian is being respected)
    assert not math.isclose(val, 3.14, rel_tol=1e-2)


def test_f32_badc_word_swap():
    # word-swap: words reversed
    val = decode_value([0xF5C3, 0x4048], "f32", "BADC")
    assert math.isclose(val, 3.14, rel_tol=1e-5)


def test_f32_dcba():
    # fully reversed
    val = decode_value([0xC3F5, 0x4840], "f32", "DCBA")
    assert math.isclose(val, 3.14, rel_tol=1e-5)


def test_f64_abcd():
    # 3.14159 as IEEE 754 double = 0x400921F9F01B866E
    val = decode_value([0x4009, 0x21F9, 0xF01B, 0x866E], "f64", "ABCD")
    assert math.isclose(val, 3.14159, rel_tol=1e-9)


# ── BCD ───────────────────────────────────────────────────────


def test_bcd16_basic():
    # 0x1234 → 1234
    assert decode_value([0x1234], "bcd16") == 1234


def test_bcd32_basic():
    # 0x12345678 → 12345678
    assert decode_value([0x1234, 0x5678], "bcd32", "ABCD") == 12345678


def test_bcd_invalid_digit():
    try:
        decode_value([0x12AB], "bcd16")  # 0xAB has nibble A=10
    except DecoderError:
        return
    raise AssertionError("expected DecoderError on invalid BCD")


# ── bit ───────────────────────────────────────────────────────


def test_bit_low():
    assert decode_value([0x0001], "bit", bit_index=0) is True
    assert decode_value([0x0001], "bit", bit_index=1) is False


def test_bit_high():
    assert decode_value([0x8000], "bit", bit_index=15) is True
    assert decode_value([0x8000], "bit", bit_index=14) is False


def test_bit_invalid_index():
    try:
        decode_value([0x0001], "bit", bit_index=16)
    except DecoderError:
        return
    raise AssertionError("expected DecoderError for bit_index > 15")


# ── string ────────────────────────────────────────────────────


def test_ascii_basic():
    # "AB" → 0x4142 → word 0x4142
    assert decode_value([0x4142], "ascii", string_len=2) == "AB"


def test_ascii_padded():
    # "A\0" → 0x4100
    assert decode_value([0x4100], "ascii", string_len=2) == "A"


def test_utf8_basic():
    # "你" = 0xE4 0xBD 0xA0 (3 bytes) → 2 registers; string_len is BYTE count
    val = decode_value([0xE4BD, 0xA000], "utf8", string_len=3)
    assert val == "你"


# ── time / duration ──────────────────────────────────────────


def test_time_epoch():
    # 2020-01-01 00:00:00 UTC = 1577836800 = 0x5E0BE100
    assert decode_value([0x5E0B, 0xE100], "time", "ABCD") == 1577836800


def test_duration_ms():
    val = decode_value([0x42C8, 0x0000], "duration", "ABCD")  # 100.0 ms
    assert math.isclose(val, 100.0, rel_tol=1e-5)


# ── encode roundtrip ──────────────────────────────────────────


def test_roundtrip_u16():
    for v in [0, 1, 100, 0xFFFF]:
        assert decode_value(encode_value(v, "u16"), "u16") == v


def test_roundtrip_i16():
    for v in [-32768, -1, 0, 1, 32767]:
        assert decode_value(encode_value(v, "i16"), "i16") == v


def test_roundtrip_u32():
    for v in [0, 1, 0xFFFFFFFF]:
        for e in ENDIANS:
            assert decode_value(encode_value(v, "u32", e), "u32", e) == v


def test_roundtrip_f32():
    for v in [0.0, 1.0, 3.14, -273.15, 1e-6]:
        for e in ENDIANS:
            decoded = decode_value(encode_value(v, "f32", e), "f32", e)
            assert math.isclose(decoded, v, rel_tol=1e-6)


def test_roundtrip_ascii():
    for s in ["HI", "TEST", "A"]:
        words = encode_value(s, "ascii", string_len=len(s))
        assert decode_value(words, "ascii", string_len=len(s)) == s


# ── catalog ───────────────────────────────────────────────────


def test_dtype_catalog_complete():
    cat = dtype_catalog()
    names = {row["dtype"] for row in cat}
    for d in DTYPES:
        assert d in names, f"dtype {d} missing from catalog"


def test_endian_catalog_complete():
    cat = endian_catalog()
    names = {row["endian"] for row in cat}
    for e in ENDIANS:
        assert e in names, f"endian {e} missing from catalog"


# ── Entry point ───────────────────────────────────────────────


if __name__ == "__main__":
    import inspect
    import traceback

    tests = [
        (name, fn) for name, fn in globals().items()
        if name.startswith("test_") and callable(fn)
    ]
    passed = failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  ✓ {name}")
            passed += 1
        except Exception:
            print(f"  ✕ {name}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed (of {len(tests)})")
    sys.exit(0 if failed == 0 else 1)
