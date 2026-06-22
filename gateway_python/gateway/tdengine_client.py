"""
1052-OS Industrial Gateway — TDengine Time-Series Client
Supports both native taosws (local) and REST API (remote) connections.
"""

import json
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


def _parse_iso(val: str) -> datetime | str:
    """Try to parse ISO timestamp, return original if fails."""
    try:
        return datetime.fromisoformat(val)
    except (ValueError, TypeError):
        return val


@dataclass
class TdConfig:
    host: str = "localhost"
    port: int = 6041
    user: str = "root"
    password: str = "taosdata"
    database: str = "industrial"
    use_rest: bool = False  # True: REST API, False: native taosws

    @property
    def dsn(self) -> str:
        return f"taosws://{self.user}:{self.password}@{self.host}:{self.port}"

    def to_dict(self) -> dict:
        return {
            "host": self.host,
            "port": self.port,
            "user": self.user,
            "password": self.password,
            "database": self.database,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TdConfig":
        return cls(
            host=d.get("host", "localhost"),
            port=d.get("port", 6041),
            user=d.get("user", "root"),
            password=d.get("password", "taosdata"),
            database=d.get("database", "industrial"),
        )


class TdClient:
    """TDengine client — auto-selects REST API (remote) or native taosws (local)."""

    def __init__(self, config: TdConfig | None = None):
        self.config = config or TdConfig()
        self._conn = None  # taosws.Connection (native only)
        self._rest_url = ""
        self._rest_auth = ""

    # ── Connection ────────────────────────────────────

    def connect(self):
        if self.config.use_rest or self.config.host not in ("localhost", "127.0.0.1"):
            self._connect_rest()
        else:
            self._connect_native()

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None
        self._rest_url = ""

    # ── REST backend ──────────────────────────────────

    def _connect_rest(self):
        import base64
        auth_str = f"{self.config.user}:{self.config.password}"
        self._rest_auth = base64.b64encode(auth_str.encode()).decode()
        # Create database (no db context needed)
        root_url = f"http://{self.config.host}:{self.config.port}/rest/sql"
        self._rest_url = root_url
        self._exec_rest(f"CREATE DATABASE IF NOT EXISTS {self.config.database} KEEP 365 DURATION 10 BUFFER 16")
        # Switch to database-scoped URL for all subsequent queries
        self._rest_url = f"http://{self.config.host}:{self.config.port}/rest/sql/{self.config.database}"

    def _rest_req(self, sql: str) -> dict:
        """Send SQL via REST API, return parsed result."""
        data = sql.encode("utf-8")
        req = urllib.request.Request(
            self._rest_url,
            data=data,
            headers={
                "Authorization": f"Basic {self._rest_auth}",
                "Content-Type": "text/plain",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"TDengine REST error {e.code}: {body[:200]}")
        except Exception as e:
            raise RuntimeError(f"TDengine REST: {e}")

    def _exec_rest(self, sql: str):
        self._rest_req(sql)

    def _query_rest(self, sql: str) -> list[dict]:
        r = self._rest_req(sql)
        if r.get("code") != 0:
            raise RuntimeError(f"TDengine error: {r.get('desc','?')}")
        col_meta = r.get("column_meta", [])
        col_names = [c[0] for c in col_meta]
        rows = []
        for row in r.get("data", []):
            d = {}
            for i, name in enumerate(col_names):
                val = row[i] if i < len(row) else None
                if isinstance(val, str):
                    val = _parse_iso(val)
                d[name] = val
            rows.append(d)
        return rows

    # ── Native backend ────────────────────────────────

    def _connect_native(self):
        import taosws
        self._conn = taosws.connect(self.config.dsn)
        self._exec_native(f"CREATE DATABASE IF NOT EXISTS {self.config.database} KEEP 365 DURATION 10 BUFFER 16")
        self._exec_native(f"USE {self.config.database}")

    def _exec_native(self, sql: str):
        self._conn.execute(sql)

    def _query_native(self, sql: str) -> list[dict]:
        r = self._conn.query(sql)
        fields = [f.name() for f in r.fields]
        rows = []
        for row in r:
            d = {}
            for i, f in enumerate(fields):
                val = row[i]
                if isinstance(val, datetime):
                    val = val.isoformat()
                d[f] = val
            rows.append(d)
        return rows

    # ── Unified interface ────────────────────────────

    def _exec(self, sql: str):
        if self._rest_url:
            self._exec_rest(sql)
        else:
            self._exec_native(sql)

    def _query(self, sql: str) -> list[dict]:
        if self._rest_url:
            return self._query_rest(sql)
        return self._query_native(sql)

    # ── Table management ──────────────────────────────

    def ensure_supertable(self, name: str, columns: dict[str, str], tags: dict[str, str]):
        """Create supertable if not exists. columns={col:type}, tags={tag:type}."""
        cols_sql = ", ".join(f"{k} {v}" for k, v in columns.items())
        tags_sql = ", ".join(f"{k} {v}" for k, v in tags.items())
        sql = f"CREATE STABLE IF NOT EXISTS {name} (ts TIMESTAMP, {cols_sql}) TAGS ({tags_sql})"
        self._exec(sql)

    def ensure_table(self, name: str, supertable: str, tag_values: dict[str, Any]):
        """Create child table using supertable with tag values."""
        tags_sql = ", ".join(str(v) if not isinstance(v, str) else f"'{v}'" for v in tag_values.values())
        cols_sql = ", ".join(tag_values.keys())
        sql = f"CREATE TABLE IF NOT EXISTS {name} USING {supertable} TAGS ({tags_sql})"
        self._exec(sql)

    # ── Write ─────────────────────────────────────────

    def insert(self, table: str, ts: datetime | str, values: dict[str, Any]):
        """Insert one row. Auto-creates table if needed."""
        # Auto-create as normal table if not exists
        cols_def = ", ".join(f"{k} DOUBLE" for k in values.keys())
        self._exec(f"CREATE TABLE IF NOT EXISTS {table} (ts TIMESTAMP, {cols_def})")

        if isinstance(ts, str):
            ts_str = f"'{ts}'"
        else:
            ts_str = f"'{ts.isoformat()}'"
        cols = ", ".join(values.keys())
        vals = ", ".join(
            str(v) if not isinstance(v, str) else f"'{v}'" for v in values.values()
        )
        sql = f"INSERT INTO {table} (ts, {cols}) VALUES ({ts_str}, {vals})"
        self._exec(sql)

    def insert_batch(self, table: str, rows: list[tuple[datetime | str, dict[str, Any]]]):
        """Batch insert multiple rows."""
        for ts, values in rows:
            self.insert(table, ts, values)

    # ── Query ─────────────────────────────────────────

    def query_range(self, table: str, start: str, end: str, limit: int = 1000) -> list[dict]:
        """Query data in time range."""
        sql = f"SELECT * FROM {table} WHERE ts >= '{start}' AND ts <= '{end}' ORDER BY ts LIMIT {limit}"
        return self._query(sql)

    def query_latest(self, table: str, limit: int = 100) -> list[dict]:
        """Query latest records."""
        try:
            sql = f"SELECT * FROM {table} ORDER BY ts DESC LIMIT {limit}"
            return self._query(sql)
        except Exception:
            return []

    def query_last(self, table: str, col: str) -> Any:
        """Get the last value of a column."""
        r = self._query(f"SELECT LAST({col}) FROM {table}")
        return r[0] if r else None

    def query_aggregate(self, table: str, col: str, interval: str, start: str, end: str, agg: str = "avg") -> list[dict]:
        """Aggregate query: avg/max/min over time intervals."""
        if not start:
            start = "1970-01-01 00:00:00"
        if not end:
            import datetime
            end = (datetime.datetime.now() + datetime.timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
        sql = f"SELECT _wstart, {agg.upper()}({col}) as val FROM {table} WHERE ts >= '{start}' AND ts <= '{end}' INTERVAL({interval})"
        return self._query(sql)

    def list_tables(self) -> list[str]:
        try:
            r = self._query("SHOW TABLES")
            result = []
            for row in r:
                vals = list(row.values())
                if vals:
                    result.append(str(vals[0]))
            return result
        except Exception:
            return []

    def list_stables(self) -> list[str]:
        try:
            r = self._query("SHOW STABLES")
            result = []
            for row in r:
                vals = list(row.values())
                if vals:
                    result.append(str(vals[0]))
            return result
        except Exception:
            return []

    def describe(self, table: str) -> list[dict]:
        return self._query(f"DESCRIBE {table}")

    def count(self, table: str) -> int:
        r = self._query(f"SELECT COUNT(*) as cnt FROM {table}")
        return r[0]["cnt"] if r else 0

    def ping(self) -> dict:
        try:
            r = self._query("SELECT server_version()")
            ver = list(r[0].values())[0] if r else "unknown"
            return {"ok": True, "version": str(ver), "database": self.config.database}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *args):
        self.close()


def ensure_tag_schema(td: "TdClient", table: str, tag_id: str, dtype: str = "DOUBLE") -> str:
    """Idempotently create a {table} supertable + {table}_{tag_id} child for a tag.

    Returns the child table name. Used by both CollectTask.start_task() and the
    generic /api/td/insert endpoint so Node-RED-driven tags get the same schema
    as Python-driver tasks.
    """
    td.ensure_supertable(table, {"v": dtype}, {"task_id": "NCHAR(128)"})
    # TDengine identifiers forbid `/`, `-`, `.` etc. — replace with `_`. The
    # original tag_id (with `/` as path separator) is preserved as the TAG
    # value so downstream queries can still group by site/device/tag.
    safe = tag_id.replace("/", "_").replace("-", "_").replace(".", "_")
    child = f"{table}_{safe}"[:192]
    td.ensure_table(child, table, {"task_id": tag_id})
    return child
