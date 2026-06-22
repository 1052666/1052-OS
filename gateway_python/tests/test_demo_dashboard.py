"""Dashboard demo flow + ui_* node factories."""
from gateway.demo_flows import build_demo_flow, list_demos


def test_dashboard_demo_listed():
    names = [d["name"] for d in list_demos()]
    assert "dashboard-demo" in names


def test_dashboard_demo_has_ui_nodes():
    nodes = build_demo_flow("dashboard-demo")
    types = {n["type"] for n in nodes}
    # ui_base is the dashboard config (1 per dashboard)
    assert "ui_base" in types
    assert "ui_tab" in types
    assert "ui_group" in types
    assert "ui_gauge" in types
    assert "ui_chart" in types


def test_dashboard_demo_data_path():
    """inject → http request → function → ui_gauge + ui_chart."""
    nodes = build_demo_flow("dashboard-demo")
    inject = next(n for n in nodes if n["type"] == "inject")
    fn = next(n for n in nodes if n["type"] == "function")
    gauge = next(n for n in nodes if n["type"] == "ui_gauge")
    chart = next(n for n in nodes if n["type"] == "ui_chart")
    # inject fires every 5s
    assert inject["repeat"] == "5"
    # function feeds both gauge and chart (2 outputs)
    assert fn["wires"] == [[gauge["id"], chart["id"]]]
    # gauge and chart point to same group
    assert gauge["group"] == chart["group"]
