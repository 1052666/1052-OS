"""Unit tests for gateway.nodered_runtime.NodeRedRuntime.

The runtime spawns a real `node-red` subprocess in production. In tests we
mock subprocess.Popen + urllib.request.urlopen so the test never depends on
Node.js being installed.
"""
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway import nodered_runtime
from gateway.nodered_runtime import NodeRedRuntime, _bootstrap_flow


# ── Prerequisite check ─────────────────────────────────


def test_ensure_prerequisites_raises_when_no_node(monkeypatch):
    monkeypatch.setattr(nodered_runtime.shutil, "which", lambda _: None)
    rt = NodeRedRuntime()
    with pytest.raises(RuntimeError, match="Node.js not found"):
        rt._ensure_prerequisites()


def test_ensure_prerequisites_installs_node_red_when_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(nodered_runtime.shutil, "which",
                        lambda cmd: "/usr/bin/node" if cmd == "node" else None)
    fake_run = mock.MagicMock(return_value=mock.MagicMock(returncode=0))
    monkeypatch.setattr(nodered_runtime.subprocess, "run", fake_run)
    rt = NodeRedRuntime()
    rt._ensure_prerequisites()
    fake_run.assert_called_once()
    args = fake_run.call_args.args[0]
    assert args[0] == "npm"
    assert "node-red" in args


def test_ensure_prerequisites_noop_when_node_red_present(monkeypatch):
    monkeypatch.setattr(nodered_runtime.shutil, "which",
                        lambda cmd: f"/usr/bin/{cmd}")
    fake_run = mock.MagicMock()
    monkeypatch.setattr(nodered_runtime.subprocess, "run", fake_run)
    NodeRedRuntime()._ensure_prerequisites()
    fake_run.assert_not_called()


# ── Bootstrap flow seeding ─────────────────────────────


def test_bootstrap_flow_substitutes_gateway_url():
    flows = _bootstrap_flow("http://example.test:9000")
    http_node = next(n for n in flows if n["type"] == "http request")
    assert http_node["url"] == "http://example.test:9000/api/td/insert"


def test_seed_writes_flows_when_missing(tmp_path):
    rt = NodeRedRuntime(user_dir=tmp_path, gateway_api_url="http://x:1")
    rt._seed_bootstrap_if_missing()
    flows = json.loads((tmp_path / "flows.json").read_text())
    assert isinstance(flows, list)
    assert any(n["type"] == "tab" and n["label"] == "1052os-bootstrap" for n in flows)


def test_seed_does_not_overwrite_existing_flows(tmp_path):
    flows_path = tmp_path / "flows.json"
    flows_path.write_text(json.dumps([{"id": "user-flow", "type": "tab", "label": "mine"}]))
    rt = NodeRedRuntime(user_dir=tmp_path, gateway_api_url="http://x:1")
    rt._seed_bootstrap_if_missing()
    assert json.loads(flows_path.read_text()) == [
        {"id": "user-flow", "type": "tab", "label": "mine"}
    ]


def test_settings_written_only_when_missing(tmp_path):
    rt = NodeRedRuntime(user_dir=tmp_path, port=9999)
    rt._write_settings_if_missing()
    text = (tmp_path / "settings.js").read_text()
    assert "uiPort: 9999" in text

    # Second call doesn't overwrite.
    (tmp_path / "settings.js").write_text("// user edited")
    rt._write_settings_if_missing()
    assert (tmp_path / "settings.js").read_text() == "// user edited"


# ── Spawn / lifecycle ──────────────────────────────────


def _make_proc_mock(pid=12345, alive=True):
    proc = mock.MagicMock(spec=subprocess.Popen)
    proc.pid = pid
    proc.poll.return_value = None if alive else 1
    return proc


def test_spawn_uses_node_red_with_userdir_and_port(monkeypatch, tmp_path):
    monkeypatch.setattr(nodered_runtime.shutil, "which",
                        lambda c: f"/usr/bin/{c}")
    fake_proc = _make_proc_mock(alive=True)
    popen = mock.MagicMock(return_value=fake_proc)
    monkeypatch.setattr(nodered_runtime.subprocess, "Popen", popen)
    monkeypatch.setattr(nodered_runtime.time, "time", lambda: 1000.0)

    rt = NodeRedRuntime(user_dir=tmp_path, port=1880)
    rt.start()
    cmd = popen.call_args.args[0]
    assert cmd[0] == "node-red"
    assert "--userDir" in cmd and str(tmp_path) in cmd
    assert "--port" in cmd and "1880" in cmd
    assert "--settings" in cmd
    # start_new_session so we can kill the whole process group on stop.
    assert popen.call_args.kwargs.get("start_new_session") is True
    rt.stop()


def test_start_fails_fast_when_port_is_already_bound(monkeypatch, tmp_path):
    monkeypatch.setattr(nodered_runtime.shutil, "which",
                        lambda c: f"/usr/bin/{c}")
    popen = mock.MagicMock()
    monkeypatch.setattr(nodered_runtime.subprocess, "Popen", popen)

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(1)
    port = sock.getsockname()[1]
    try:
        rt = NodeRedRuntime(user_dir=tmp_path, port=port)
        with pytest.raises(RuntimeError, match=f"port {port} already in use"):
            rt.start()
        assert rt.status()["last_error"] == f"Node-RED port {port} already in use"
        popen.assert_not_called()
    finally:
        sock.close()


def test_start_is_noop_if_already_running(monkeypatch, tmp_path):
    monkeypatch.setattr(nodered_runtime.shutil, "which",
                        lambda c: f"/usr/bin/{c}")
    popen = mock.MagicMock(return_value=_make_proc_mock(alive=True))
    monkeypatch.setattr(nodered_runtime.subprocess, "Popen", popen)
    rt = NodeRedRuntime(user_dir=tmp_path)
    rt.start()
    rt.start()
    assert popen.call_count == 1
    rt.stop()


def test_stop_signals_process_group(monkeypatch, tmp_path):
    monkeypatch.setattr(nodered_runtime.shutil, "which",
                        lambda c: f"/usr/bin/{c}")
    popen = mock.MagicMock(return_value=_make_proc_mock(alive=True))
    monkeypatch.setattr(nodered_runtime.subprocess, "Popen", popen)

    killpg = mock.MagicMock()
    monkeypatch.setattr(nodered_runtime.os, "killpg", killpg)

    rt = NodeRedRuntime(user_dir=tmp_path)
    rt.start()
    rt.stop()
    # SIGTERM was sent to the process group.
    assert killpg.called
    args = killpg.call_args_list[0].args
    assert args[1] == nodered_runtime.signal.SIGTERM


def test_status_reports_running_and_pid(monkeypatch, tmp_path):
    monkeypatch.setattr(nodered_runtime.shutil, "which",
                        lambda c: f"/usr/bin/{c}")
    popen = mock.MagicMock(return_value=_make_proc_mock(pid=42, alive=True))
    monkeypatch.setattr(nodered_runtime.subprocess, "Popen", popen)

    rt = NodeRedRuntime(user_dir=tmp_path, port=1880)
    rt.start()
    s = rt.status()
    assert s["running"] is True
    assert s["port"] == 1880
    assert s["pid"] == 42
    assert s["uptime_s"] is not None
    rt.stop()


def test_status_after_stop(monkeypatch, tmp_path):
    monkeypatch.setattr(nodered_runtime.shutil, "which",
                        lambda c: f"/usr/bin/{c}")
    popen = mock.MagicMock(return_value=_make_proc_mock(alive=True))
    monkeypatch.setattr(nodered_runtime.subprocess, "Popen", popen)
    rt = NodeRedRuntime(user_dir=tmp_path)
    rt.start()
    rt.stop()
    s = rt.status()
    assert s["running"] is False
    assert s["pid"] is None


def test_wait_ready_returns_true_on_200(monkeypatch, tmp_path):
    monkeypatch.setattr(nodered_runtime.shutil, "which",
                        lambda c: f"/usr/bin/{c}")
    popen = mock.MagicMock(return_value=_make_proc_mock(alive=True))
    monkeypatch.setattr(nodered_runtime.subprocess, "Popen", popen)

    # Mock urlopen to return 200 immediately.
    fake_resp = mock.MagicMock()
    fake_resp.__enter__ = lambda s: s
    fake_resp.__exit__ = lambda *a: None
    fake_resp.status = 200
    monkeypatch.setattr(
        nodered_runtime.urllib.request, "urlopen",
        mock.MagicMock(return_value=fake_resp),
    )
    rt = NodeRedRuntime(user_dir=tmp_path)
    rt.start()
    try:
        assert rt.wait_ready(timeout=2.0) is True
    finally:
        rt.stop()


def test_wait_ready_returns_false_on_timeout(monkeypatch, tmp_path):
    monkeypatch.setattr(nodered_runtime.shutil, "which",
                        lambda c: f"/usr/bin/{c}")
    monkeypatch.setattr(nodered_runtime.subprocess, "Popen",
                        mock.MagicMock(return_value=_make_proc_mock(alive=True)))
    # Always raise URLError
    def _fail(*a, **kw):
        raise nodered_runtime.urllib.error.URLError("nope")
    monkeypatch.setattr(nodered_runtime.urllib.request, "urlopen", _fail)

    rt = NodeRedRuntime(user_dir=tmp_path)
    rt.start()
    try:
        assert rt.wait_ready(timeout=1.0) is False
    finally:
        rt.stop()


# ── Reset bootstrap ────────────────────────────────────


def test_reset_bootstrap_overwrites(tmp_path):
    rt = NodeRedRuntime(user_dir=tmp_path, gateway_api_url="http://x:1")
    (tmp_path / "flows.json").write_text("[]")
    rt.reset_bootstrap()
    flows = json.loads((tmp_path / "flows.json").read_text())
    assert any(n["type"] == "tab" for n in flows)


# ── Crash-loop guard ───────────────────────────────────


def test_maybe_restart_stops_after_too_many_crashes(monkeypatch, tmp_path, capsys):
    rt = NodeRedRuntime(user_dir=tmp_path)
    # Fill restart history.
    rt._restart_history = [time.time()] * nodered_runtime.MAX_RESTARTS_PER_WINDOW
    rt._maybe_restart()
    captured = capsys.readouterr()
    assert "crash loop" in captured.err
    # No new proc spawned.
    assert rt._proc is None
