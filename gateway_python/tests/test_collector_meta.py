import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.collector import CollectTask


def test_collecttask_site_default():
    t = CollectTask(id="440001", protocol="modbus", table="raw_data")
    d = t.to_dict()
    assert d["site"] == "default"
    assert d["device"] == "raw_data"  # default device = table name


def test_collecttask_from_dict_preserves_site():
    t = CollectTask.from_dict({
        "id": "440001", "protocol": "modbus",
        "site": "site1", "device": "plc1", "table": "raw_data",
    })
    assert t.site == "site1"
    assert t.device == "plc1"


def test_collecttask_to_dict_roundtrip():
    t = CollectTask(id="440001", protocol="modbus", site="site1", device="plc1", table="raw_data")
    d = t.to_dict()
    t2 = CollectTask.from_dict(d)
    assert t2.site == "site1"
    assert t2.device == "plc1"
