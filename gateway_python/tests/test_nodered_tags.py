import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.nodered_tags import build_tag_catalog
from gateway.collector import CollectTask


def _mk_task(tid, **kw):
    return CollectTask(id=tid, protocol=kw.get("protocol", "modbus"),
                       table=kw.get("table", "raw_data"),
                       site=kw.get("site", "default"),
                       device=kw.get("device", "plc1"),
                       dtype=kw.get("dtype", "u16"),
                       endian=kw.get("endian", "ABCD"),
                       interval=kw.get("interval", 1.0))


def test_build_tag_catalog_empty():
    assert build_tag_catalog({}) == []


def test_build_tag_catalog_modbus():
    tasks = {"440001": _mk_task("440001", dtype="f32", endian="CDAB")}
    cat = build_tag_catalog(tasks)
    assert len(cat) == 1
    assert cat[0]["tag"] == "440001"
    assert cat[0]["protocol"] == "modbus"
    assert cat[0]["dtype"] == "f32"
    assert cat[0]["endian"] == "CDAB"
    assert cat[0]["interval"] == 1.0
    assert cat[0]["topic"] == "1052os/default/plc1/440001/value"


def test_build_tag_catalog_opcua():
    tasks = {"x": _mk_task("x", protocol="opcua", table="dev1",
                           site="site1", device="plc1")}
    cat = build_tag_catalog(tasks)
    assert cat[0]["protocol"] == "opcua"
    assert cat[0]["topic"] == "1052os/site1/plc1/x/value"
