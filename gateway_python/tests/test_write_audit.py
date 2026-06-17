"""Tests for WriteAuditLogger (Sub-3 Task 1).

Logs every Modbus/OPC UA write command to TDengine write_audit table.
7-day retention (project-init policy; manual cleanup).
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.write_audit import WriteAuditLogger


def test_audit_log_calls_td_exec():
    """A successful log() call must invoke td._exec with INSERT INTO a write_audit child table."""
    td = MagicMock()
    logger = WriteAuditLogger(td)
    logger.log(
        request_id="abc123",
        source="nodered:test",
        protocol="modbus",
        target="127.0.0.1:502/u1/0",
        cmd="write_coil",
        value=True,
        result="ok",
    )
    assert td._exec.called
    # TDengine stable architecture: child table is `w_<rid>`, parent is `write_audit`.
    all_sqls = " ".join(c.args[0] for c in td._exec.call_args_list)
    assert "USING write_audit" in all_sqls, "child table must reference write_audit stable"
    insert_sqls = [c.args[0] for c in td._exec.call_args_list if "INSERT INTO" in c.args[0]]
    assert len(insert_sqls) >= 1, "expected at least one INSERT INTO call"
    sql = insert_sqls[0]
    assert "modbus" in sql
    assert "write_coil" in sql
    assert "ok" in sql


def test_audit_log_with_error_includes_error_field():
    """When result=error, the error message must be embedded in the SQL."""
    td = MagicMock()
    logger = WriteAuditLogger(td)
    logger.log(
        request_id="x", source="y", protocol="modbus", target="z",
        cmd="write_coil", value=True, result="error", error="FC5 failed",
    )
    insert_sqls = [c.args[0] for c in td._exec.call_args_list if "INSERT INTO" in c.args[0]]
    assert len(insert_sqls) >= 1
    sql = insert_sqls[0]
    assert "FC5 failed" in sql


def test_audit_log_handles_complex_values():
    """Float values like 3.14 must be stringified into value_str."""
    td = MagicMock()
    logger = WriteAuditLogger(td)
    logger.log(
        request_id="x", source="y", protocol="modbus", target="z",
        cmd="write_float32", value=3.14, result="ok",
    )
    insert_sqls = [c.args[0] for c in td._exec.call_args_list if "INSERT INTO" in c.args[0]]
    assert len(insert_sqls) >= 1
    sql = insert_sqls[0]
    assert "3.14" in sql


def test_audit_log_handles_list_values():
    """List values (write_coils / write_registers) must serialize without crashing."""
    td = MagicMock()
    logger = WriteAuditLogger(td)
    logger.log(
        request_id="x", source="y", protocol="modbus", target="z",
        cmd="write_registers", value=[10, 20, 30], result="ok",
    )
    insert_sqls = [c.args[0] for c in td._exec.call_args_list if "INSERT INTO" in c.args[0]]
    assert len(insert_sqls) >= 1
    sql = insert_sqls[0]
    assert "10" in sql and "20" in sql and "30" in sql


def test_audit_ensure_table_creates_stable():
    """ensure_table() must issue CREATE STABLE IF NOT EXISTS write_audit."""
    td = MagicMock()
    logger = WriteAuditLogger(td)
    logger.ensure_table()
    assert td._exec.called
    sql = td._exec.call_args_list[0].args[0]
    assert "CREATE STABLE IF NOT EXISTS write_audit" in sql
    assert "TAGS" in sql


def test_audit_ensure_table_is_idempotent():
    """Calling ensure_table twice must not raise."""
    td = MagicMock()
    logger = WriteAuditLogger(td)
    logger.ensure_table()
    logger.ensure_table()  # second call is a no-op
    # Both calls should not raise


def test_audit_log_does_not_raise_on_td_error():
    """If td._exec fails, log() must swallow the error (audit must not break the main flow)."""
    td = MagicMock()
    td._exec.side_effect = RuntimeError("TDengine offline")
    logger = WriteAuditLogger(td)
    # Should not raise
    logger.log(
        request_id="x", source="y", protocol="modbus", target="z",
        cmd="write_coil", value=True, result="ok",
    )
