"""TDengine auto-connect + config persistence.

Exercises the three new pieces:
  - _load_td_config() / _save_td_config() round-trip via disk
  - td_connect endpoint persists the user's config so it survives restart
  - _try_auto_connect_td() retries until success or deadline

The conftest disables GATEWAY_DISABLE_AUTOCONNECT globally; this file re-enables
it selectively for the auto-connect tests.
"""
import json
import os
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


# ── Persistence ─────────────────────────────────────────────


def test_load_returns_defaults_when_no_file(tmp_path, monkeypatch):
    monkeypatch.setattr("gateway.server._TD_CONFIG_PATH", tmp_path / "td-config.json")
    import gateway.server as srv
    cfg = srv._load_td_config()
    assert cfg.host == "localhost"
    assert cfg.port == 6041
    assert cfg.database == "industrial"


def test_save_and_load_roundtrip(tmp_path, monkeypatch):
    p = tmp_path / "td-config.json"
    monkeypatch.setattr("gateway.server._TD_CONFIG_PATH", p)
    import gateway.server as srv
    custom = srv.TdConfig(host="10.0.0.5", port=6042, user="alice",
                          password="s3cret", database="plant_a")
    srv._save_td_config(custom)
    assert p.exists()
    loaded = srv._load_td_config()
    assert loaded.host == "10.0.0.5"
    assert loaded.port == 6042
    assert loaded.user == "alice"
    assert loaded.password == "s3cret"
    assert loaded.database == "plant_a"


def test_load_silently_uses_defaults_on_corrupt_file(tmp_path, monkeypatch):
    p = tmp_path / "td-config.json"
    p.write_text("{not valid json")
    monkeypatch.setattr("gateway.server._TD_CONFIG_PATH", p)
    import gateway.server as srv
    cfg = srv._load_td_config()  # should not raise
    assert cfg.host == "localhost"


# ── Endpoint persists config ─────────────────────────────────


def test_td_connect_endpoint_persists_config(tmp_path, monkeypatch):
    """POST /api/td/connect with a custom config writes the file."""
    from gateway.server import app
    p = tmp_path / "td-config.json"
    monkeypatch.setattr("gateway.server._TD_CONFIG_PATH", p)

    class FakeTd:
        def __init__(self, cfg): self.cfg = cfg
        def connect(self): pass
        def ping(self): return {"ok": True, "version": "fake"}
        def close(self): pass  # lifespan teardown calls this
    def fake_connect(cfg):
        srv = __import__("gateway.server", fromlist=["_td", "_collector"])
        srv._td = FakeTd(cfg)
        return srv._td
    monkeypatch.setattr("gateway.server._connect_td_engine", fake_connect)

    with TestClient(app) as client:
        r = client.post("/api/td/connect", json={
            "host": "192.168.10.254", "port": 6041, "user": "root",
            "password": "taosdata", "database": "industrial",
        })
    assert r.status_code == 200
    assert p.exists()
    body = json.loads(p.read_text())
    assert body["host"] == "192.168.10.254"
    assert body["database"] == "industrial"


# ── Auto-connect retry loop ──────────────────────────────────


def test_try_auto_connect_succeeds_on_first_try():
    import gateway.server as srv
    calls = []
    def fake_connect(cfg):
        calls.append(cfg.host)
        return srv.TdClient.__new__(srv.TdClient)
    with patch.object(srv, "_connect_td_engine", side_effect=fake_connect):
        ok = srv._try_auto_connect_td(srv.TdConfig(), deadline_s=1.0, interval_s=0.1)
    assert ok is True
    assert calls == ["localhost"]


def test_try_auto_connect_retries_until_success():
    import gateway.server as srv
    attempts = {"n": 0}
    def flaky(cfg):
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise ConnectionError(f"attempt {attempts['n']}")
        return srv.TdClient.__new__(srv.TdClient)
    with patch.object(srv, "_connect_td_engine", side_effect=flaky):
        ok = srv._try_auto_connect_td(srv.TdConfig(), deadline_s=5.0, interval_s=0.05)
    assert ok is True
    assert attempts["n"] == 3


def test_try_auto_connect_gives_up_after_deadline():
    import gateway.server as srv
    def always_fail(cfg):
        raise ConnectionError("never up")
    with patch.object(srv, "_connect_td_engine", side_effect=always_fail):
        t0 = time.monotonic()
        ok = srv._try_auto_connect_td(srv.TdConfig(), deadline_s=0.3, interval_s=0.1)
        elapsed = time.monotonic() - t0
    assert ok is False
    assert 0.25 <= elapsed <= 1.0  # ~3 attempts in 0.3s


# ── Lifespan integration: auto-connect runs at startup ──────


def test_lifespan_autoconnects_when_enabled(tmp_path, monkeypatch):
    """When GATEWAY_DISABLE_AUTOCONNECT is NOT set, lifespan spawns the
    auto-connect thread and (with a fast-succeeding fake) _td becomes non-None."""
    monkeypatch.delenv("GATEWAY_DISABLE_AUTOCONNECT", raising=False)
    monkeypatch.setattr("gateway.server._TD_CONFIG_PATH", tmp_path / "td-config.json")

    import gateway.server as srv
    monkeypatch.setattr(srv, "_td_config", srv.TdConfig())
    monkeypatch.setattr(srv, "_td", None)

    # Make _connect_td_engine succeed fast with a MagicMock (auto-close, etc.)
    fake_td = MagicMock(name="fake_td_client")
    def fast_connect(cfg):
        srv._td = fake_td
        srv._td_config = cfg
        # Populate the other globals too to keep /api/td/ping happy
        srv._collector = srv._collector or type("FakeCollector", (), {"mqtt_publisher": None, "stop_all": lambda self: None})()
        return fake_td
    monkeypatch.setattr(srv, "_connect_td_engine", fast_connect)

    with TestClient(srv.app):
        # Lifespan ran; auto-connect thread spawned; wait briefly for it to land
        for _ in range(50):
            if srv._td is fake_td:
                break
            time.sleep(0.05)
    assert srv._td is fake_td


def test_lifespan_skips_autoconnect_when_disabled(monkeypatch):
    monkeypatch.setenv("GATEWAY_DISABLE_AUTOCONNECT", "1")
    import gateway.server as srv
    monkeypatch.setattr(srv, "_td_config", srv.TdConfig())
    monkeypatch.setattr(srv, "_td", None)

    called = {"n": 0}
    def spy(cfg):
        called["n"] += 1
    monkeypatch.setattr(srv, "_try_auto_connect_td", spy)

    with TestClient(srv.app):
        time.sleep(0.2)
    assert called["n"] == 0  # never invoked when disabled