"""Tests for /api/td/insert — tag-driven TDengine ingestion for Node-RED.

The endpoint must auto-provision the {table}_{tag} child on first write and
coerce values based on dtype.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from gateway.server import app


class _FakeTd:
    def __init__(self):
        self.tables: list[tuple[str, dict, dict]] = []
        self.subtables: list[tuple[str, str, dict]] = []
        self.inserts: list[tuple[str, object, dict]] = []

    def connect(self): pass
    def close(self): pass

    def ensure_supertable(self, name, columns, tags):
        self.tables.append((name, columns, tags))

    def ensure_table(self, name, super_name, tags):
        self.subtables.append((name, super_name, tags))

    def insert(self, table, ts, row):
        self.inserts.append((table, ts, row))


def _install_fake_td():
    import gateway.server as srv
    fake = _FakeTd()
    srv._td = fake
    return fake


def test_insert_numeric_creates_double_column():
    fake = _install_fake_td()
    with TestClient(app) as client:
        r = client.post("/api/td/insert", json={
            "device": "plc1", "tag": "temp", "value": 21.5
        })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["dtype"] == "DOUBLE"
    assert body["table"] == "raw_data_default_plc1_temp"

    # Schema created with single DOUBLE column.
    assert any(
        name == "raw_data" and cols == {"v": "DOUBLE"}
        for name, cols, _ in fake.tables
    )
    # Child table auto-created.
    assert any(
        name == "raw_data_default_plc1_temp" and super_name == "raw_data"
        for name, super_name, _ in fake.subtables
    )
    # Insert row recorded.
    assert fake.inserts[-1][2] == {"v": 21.5}


def test_insert_string_creates_nchar_column():
    fake = _install_fake_td()
    with TestClient(app) as client:
        r = client.post("/api/td/insert", json={
            "device": "plc1", "tag": "status", "value": "online"
        })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dtype"] == "NCHAR(255)"
    assert any(
        cols == {"v": "NCHAR(255)"} for name, cols, _ in fake.tables
    )
    assert fake.inserts[-1][2] == {"v": "online"}


def test_insert_bool_inferred_as_bigint():
    fake = _install_fake_td()
    with TestClient(app) as client:
        r = client.post("/api/td/insert", json={
            "device": "plc1", "tag": "alarm", "value": True
        })
    assert r.status_code == 200, r.text
    # bool → BIGINT (since DOUBLE → 1/0 would lose the bool info, BIGINT is fine)
    assert r.json()["dtype"] == "BIGINT"
    assert fake.inserts[-1][2] == {"v": True}


def test_insert_explicit_dtype_overrides_inference():
    fake = _install_fake_td()
    with TestClient(app) as client:
        r = client.post("/api/td/insert", json={
            "device": "plc1", "tag": "temp", "value": "21.5",
            "dtype": "DOUBLE"
        })
    assert r.status_code == 200, r.text
    assert r.json()["dtype"] == "DOUBLE"
    # Value passed through unchanged (caller is responsible for parsing if they
    # chose DOUBLE on a string).
    assert fake.inserts[-1][2] == {"v": "21.5"}


def test_insert_uses_default_site_and_device():
    fake = _install_fake_td()
    with TestClient(app) as client:
        r = client.post("/api/td/insert", json={"tag": "x", "value": 1.0})
    assert r.status_code == 200, r.text
    assert r.json()["table"] == "raw_data_default_sim_x"


def test_insert_sanitizes_unsafe_chars_in_tag():
    fake = _install_fake_td()
    with TestClient(app) as client:
        r = client.post("/api/td/insert", json={
            "site": "plant-A", "device": "PLC #1", "tag": "reg-40001",
            "value": 42.0,
        })
    assert r.status_code == 200, r.text
    # All TDengine-illegal chars (/, -, .) → _ in the child table name.
    # Original tag_id (with /) is preserved as the NCHAR tag value for grouping.
    assert r.json()["table"] == "raw_data_plant_A_PLC__1_reg_40001"


def test_insert_returns_503_when_td_not_connected():
    import gateway.server as srv
    srv._td = None
    with TestClient(app) as client:
        r = client.post("/api/td/insert", json={"tag": "x", "value": 1.0})
    assert r.status_code == 503


def test_insert_idempotent_schema_creation():
    """Two inserts to the same tag should re-issue ensure_supertable/ensure_table
    (IF NOT EXISTS handles no-op server-side) and produce 2 inserts."""
    fake = _install_fake_td()
    with TestClient(app) as client:
        for v in (1.0, 2.0, 3.0):
            client.post("/api/td/insert", json={"device": "d", "tag": "t", "value": v})
    assert len(fake.inserts) == 3
    # Schema is created once per call (idempotent on TDengine side).
    matching = [t for t in fake.tables if t[0] == "raw_data"]
    assert len(matching) == 3