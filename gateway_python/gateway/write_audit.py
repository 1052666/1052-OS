"""1052-OS Industrial Gateway — Write Audit Logger

Logs every Modbus/OPC UA write command to TDengine write_audit stable.
7-day retention (project-init policy; manual cleanup).

Schema:
    CREATE STABLE write_audit (
        ts TIMESTAMP,
        request_id BINARY(64),
        source BINARY(64),
        protocol BINARY(16),
        target BINARY(256),
        cmd BINARY(32),
        value_str BINARY(256),
        result BINARY(16),
        error_msg BINARY(512)
    ) TAGS (site BINARY(64))
"""
import logging
import re
import time
import uuid

log = logging.getLogger("gateway.write_audit")


def _sanitize(s: str, max_len: int) -> str:
    """Strip newlines and quotes, truncate to TDengine BINARY(n) limit."""
    if s is None:
        return ""
    s = str(s).replace("'", "''").replace("\n", " ").replace("\r", " ")
    return s[:max_len]


class WriteAuditLogger:
    """Writes audit records to TDengine write_audit stable.

    All write operations are best-effort. Failures are logged but never raised,
    so audit problems cannot break the main write command path.
    """

    def __init__(self, td_client):
        self.td = td_client
        self._table_ensured = False

    def ensure_table(self):
        """Create the write_audit stable. Idempotent (no-op on second call)."""
        if self._table_ensured:
            return
        try:
            self.td._exec(
                "CREATE STABLE IF NOT EXISTS write_audit ("
                "ts TIMESTAMP, "
                "request_id BINARY(64), "
                "source BINARY(64), "
                "protocol BINARY(16), "
                "target BINARY(256), "
                "cmd BINARY(32), "
                "value_str BINARY(256), "
                "result BINARY(16), "
                "error_msg BINARY(512) "
                ") TAGS (site BINARY(64))"
            )
            self._table_ensured = True
        except Exception as e:
            log.warning(f"write_audit.ensure_table failed: {e}")

    def log(
        self,
        *,
        request_id: str,
        source: str,
        protocol: str,
        target: str,
        cmd: str,
        value,
        result: str,
        error: str | None = None,
        site: str = "default",
    ):
        """Append a write audit record. Never raises.

        Parameters
        ----------
        request_id : str
            Caller-provided correlation id (UUID, short string, etc.)
        source : str
            Originator tag, e.g. "nodered", "http:127.0.0.1".
        protocol : str
            "modbus" or "opcua".
        target : str
            Human-readable target spec, e.g. "127.0.0.1:502/u1/0".
        cmd : str
            Command name, e.g. "write_coil", "write_float32".
        value : any
            Value written (stringified for storage).
        result : str
            "ok" or "error".
        error : str, optional
            Error message when result="error".
        site : str, default "default"
            TDengine tag value (multi-site partitioning).
        """
        try:
            self.ensure_table()
            ts_iso = time.strftime("%Y-%m-%dT%H:%M:%S.000", time.gmtime())
            # Build a TDengine-safe child table name from request_id.
            rid = (request_id or uuid.uuid4().hex)[:32]
            rid_safe = re.sub(r"[^A-Za-z0-9_]", "_", rid)[:16]
            child_table = f"w_{rid_safe}" if rid_safe else f"w_{uuid.uuid4().hex[:8]}"
            # Ensure the child table exists (TAGS includes site).
            self.td._exec(
                f"CREATE TABLE IF NOT EXISTS {child_table} "
                f"USING write_audit TAGS ('{_sanitize(site, 64)}')"
            )
            value_str = _sanitize(repr(value), 256)
            error_msg = _sanitize(error or "", 512)
            sql = (
                f"INSERT INTO {child_table} "
                f"(ts, request_id, source, protocol, target, cmd, value_str, result, error_msg) "
                f"VALUES ('{ts_iso}', "
                f"'{_sanitize(request_id, 64)}', "
                f"'{_sanitize(source, 64)}', "
                f"'{_sanitize(protocol, 16)}', "
                f"'{_sanitize(target, 256)}', "
                f"'{_sanitize(cmd, 32)}', "
                f"'{value_str}', "
                f"'{_sanitize(result, 16)}', "
                f"'{error_msg}')"
            )
            self.td._exec(sql)
        except Exception as e:
            # Audit failure must never break the main flow
            log.warning(f"write_audit.log failed: {e}")
