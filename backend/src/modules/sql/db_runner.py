"""Unified database query runner for MySQL, Oracle, SQLite, Hive.

Usage: uv run db_runner.py
Input:  JSON via stdin
Output: JSON via stdout
"""

import json
import sys
import sqlite3

_oracle_thick_initialized = False


def connect_mysql(cfg):
    import pymysql
    return pymysql.connect(
        host=cfg.get('host', '127.0.0.1'),
        port=int(cfg.get('port', 3306)),
        user=cfg.get('user', ''),
        password=cfg.get('password', ''),
        database=cfg.get('database', ''),
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor,
    )


def connect_oracle(cfg):
    import oracledb
    global _oracle_thick_initialized
    if not _oracle_thick_initialized:
        oracledb.init_oracle_client(lib_dir=r'C:\instantclient_11_2')
        _oracle_thick_initialized = True
    host = cfg.get('host', '127.0.0.1')
    port = int(cfg.get('port', 1521))
    database = cfg.get('database', '')
    user = cfg.get('user', '')
    password = cfg.get('password', '')
    dsn = f'{host}:{port}/{database}' if database else f'{host}:{port}'
    conn = oracledb.connect(user=user, password=password, dsn=dsn)
    conn.default_fetch_lobs = False
    return conn


def connect_sqlite(cfg):
    file_path = cfg.get('filePath', '')
    if not file_path:
        raise ValueError('SQLite filePath is required')
    conn = sqlite3.connect(file_path)
    conn.row_factory = sqlite3.Row
    return conn


def connect_hive(cfg):
    from pyhive import hive
    user = cfg.get('user', '')
    password = cfg.get('password', '')
    if user and password:
        return hive.Connection(
            host=cfg.get('host', '127.0.0.1'),
            port=int(cfg.get('port', 10000)),
            username=user,
            password=password,
            database=cfg.get('database', 'default'),
            auth='CUSTOM',
        )
    return hive.Connection(
        host=cfg.get('host', '127.0.0.1'),
        port=int(cfg.get('port', 10000)),
        username=user,
        database=cfg.get('database', 'default'),
        auth='NOSASL',
    )


CONNECTORS = {
    'mysql': connect_mysql,
    'oracle': connect_oracle,
    'sqlite': connect_sqlite,
    'hive': connect_hive,
}


def do_test(cfg):
    db_type = cfg.get('type', '')
    connector = CONNECTORS.get(db_type)
    if not connector:
        raise ValueError(f'Unsupported database type: {db_type}')
    conn = connector(cfg)
    try:
        cursor = conn.cursor()
        test_sql = 'SELECT 1 FROM DUAL' if db_type == 'oracle' else 'SELECT 1'
        cursor.execute(test_sql)
        cursor.fetchall()
    finally:
        try:
            conn.close()
        except Exception:
            pass


def do_query(cfg, sql, limit):
    db_type = cfg.get('type', '')
    connector = CONNECTORS.get(db_type)
    if not connector:
        raise ValueError(f'Unsupported database type: {db_type}')
    conn = connector(cfg)
    try:
        cursor = conn.cursor()
        cursor.execute(sql)

        # DML (INSERT/UPDATE/DELETE) - no result set
        if cursor.description is None:
            affected = cursor.rowcount
            conn.commit()
            return {
                'columns': ['affectedRows'],
                'rows': [{'affectedRows': affected}],
                'rowCount': 1,
                'truncated': False,
            }

        if db_type == 'sqlite':
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            rows_raw = cursor.fetchmany(limit + 1)
            rows = [dict(zip(columns, row)) for row in rows_raw]
        elif db_type == 'mysql':
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            rows_raw = cursor.fetchmany(limit + 1)
            rows = list(rows_raw)
        elif db_type == 'oracle':
            columns = [desc[0].lower() for desc in cursor.description] if cursor.description else []
            rows_raw = cursor.fetchmany(limit + 1)
            rows = [dict(zip(columns, row)) for row in rows_raw]
        elif db_type == 'hive':
            columns = [desc[0].split('.')[-1] for desc in cursor.description] if cursor.description else []
            rows_raw = cursor.fetchmany(limit + 1)
            rows = [dict(zip(columns, row)) for row in rows_raw]
        else:
            columns = []
            rows = []

        truncated = len(rows) > limit
        if truncated:
            rows = rows[:limit]

        return {
            'columns': columns,
            'rows': rows,
            'rowCount': len(rows),
            'truncated': truncated,
        }
    finally:
        try:
            conn.close()
        except Exception:
            pass


def main():
    try:
        raw = sys.stdin.read()
        params = json.loads(raw)
    except Exception as e:
        print(json.dumps({'error': f'Invalid input: {e}'}))
        sys.exit(1)

    action = params.get('action', '')
    cfg = params.get('config', {})

    try:
        if action == 'test':
            do_test(cfg)
            print(json.dumps({'ok': True}))
        elif action == 'query':
            sql = params.get('sql', '')
            limit = int(params.get('limit', 100))
            if not sql.strip():
                raise ValueError('SQL is required')
            result = do_query(cfg, sql, limit)
            print(json.dumps(result, default=str))
        else:
            raise ValueError(f'Unknown action: {action}')
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
