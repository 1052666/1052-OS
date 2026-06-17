"""Tests for AnomalyEngine.ack_one (Sub-3 Task 3).

Acknowledge a single anomaly by channel_id + ts. Returns True if found & updated.
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.anomaly import AnomalyEngine


def _eng(td=None):
    td = td if td is not None else MagicMock()
    return AnomalyEngine(td)


def test_ack_one_calls_td_exec_with_update():
    """ack_one must query then UPDATE the anomaly_log row."""
    td = MagicMock()
    td._query.return_value = [{"ts": "2026-06-18T10:00:00+00:00"}]
    eng = AnomalyEngine(td)
    result = eng.ack_one(
        channel_id="ch1",
        ts="2026-06-18T10:00:00+00:00",
        by="operator",
    )
    assert result is True
    # Find the UPDATE call
    update_sqls = [c.args[0] for c in td._exec.call_args_list if "UPDATE" in c.args[0]]
    assert len(update_sqls) >= 1
    sql = update_sqls[0]
    assert "anomaly_log" in sql
    assert "acked" in sql
    assert "ch1" in sql


def test_ack_one_returns_false_when_no_match():
    """If no row matches channel_id+ts, return False without calling UPDATE."""
    td = MagicMock()
    td._query.return_value = []  # no rows
    eng = AnomalyEngine(td)
    result = eng.ack_one(channel_id="ch1", ts="2026-06-18T10:00:00+00:00")
    assert result is False
    # UPDATE must NOT be called
    update_sqls = [c.args[0] for c in td._exec.call_args_list if "UPDATE" in c.args[0]]
    assert len(update_sqls) == 0


def test_ack_one_uses_default_by_gateway():
    """Default by='gateway' when caller doesn't specify."""
    td = MagicMock()
    td._query.return_value = [{"ts": "2026-06-18T10:00:00+00:00"}]
    eng = AnomalyEngine(td)
    eng.ack_one("ch1", "2026-06-18T10:00:00+00:00")
    # The query should reference the channel_id
    query_sql = td._query.call_args.args[0]
    assert "ch1" in query_sql


def test_ensure_log_table_includes_acked_column():
    """The new _ensure_log_table must include 'acked BOOL' so fresh DBs get the column."""
    td = MagicMock()
    AnomalyEngine(td)
    all_sqls = " ".join(c.args[0] for c in td._exec.call_args_list)
    # Either CREATE STABLE includes the column, OR ALTER STABLE was issued.
    has_column = "acked BOOL" in all_sqls or "ADD COLUMN acked" in all_sqls
    assert has_column, "acked BOOL column must be added to anomaly_log"


def test_ack_one_does_not_raise_on_td_error():
    """If td._query or td._exec fails, ack_one must return False (not raise)."""
    td = MagicMock()
    td._query.side_effect = RuntimeError("TDengine offline")
    eng = AnomalyEngine(td)
    result = eng.ack_one("ch1", "2026-06-18T10:00:00+00:00")
    assert result is False
