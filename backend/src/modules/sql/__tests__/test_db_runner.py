"""Tests for db_runner.py Oracle Client initialization (D1-D2)."""

import os
import sys
import importlib
from unittest.mock import MagicMock, patch

import pytest

# Ensure the sql module directory is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


@pytest.fixture(autouse=True)
def reset_db_runner():
    """Reset db_runner module state between tests."""
    if 'db_runner' in sys.modules:
        del sys.modules['db_runner']
    yield
    if 'db_runner' in sys.modules:
        del sys.modules['db_runner']


@pytest.fixture
def mock_oracledb():
    """Provide a mocked oracledb module."""
    m = MagicMock()
    with patch.dict(sys.modules, {'oracledb': m}):
        yield m


def test_d1_oracle_client_path_env(mock_oracledb):
    """D1: ORACLE_CLIENT_PATH 环境变量生效"""
    import db_runner

    mock_oracledb.reset_mock()
    db_runner._oracle_thick_initialized = False

    with patch.dict(os.environ, {'ORACLE_CLIENT_PATH': '/opt/oracle'}):
        db_runner._init_oracle_client(mock_oracledb)

    mock_oracledb.init_oracle_client.assert_called_once_with(lib_dir='/opt/oracle')
    assert db_runner._oracle_thick_initialized is True


def test_d2_no_env_thin_mode(mock_oracledb):
    """D2: 未设置环境变量时自动降级到 thin 模式"""
    import db_runner

    mock_oracledb.reset_mock()
    mock_oracledb.init_oracle_client.side_effect = None
    db_runner._oracle_thick_initialized = False

    env = dict(os.environ)
    env.pop('ORACLE_CLIENT_PATH', None)
    with patch.dict(os.environ, env, clear=True):
        db_runner._init_oracle_client(mock_oracledb)

    mock_oracledb.init_oracle_client.assert_called_once()
    assert db_runner._oracle_thick_initialized is True
