"""Demo flow registry + idempotent merge."""
import pytest

from gateway.demo_flows import (
    DEMOS, build_demo_flow, list_demos, merge_into_flows, installed_demos,
)


def test_list_demos_returns_both():
    names = [d["name"] for d in list_demos()]
    assert "mqtt-to-td" in names
    assert "http-to-td" in names


def test_build_mqtt_flow_has_required_nodes():
    nodes = build_demo_flow("mqtt-to-td")
    types = [n["type"] for n in nodes]
    assert "tab" in types
    assert "mqtt in" in types
    assert "function" in types
    assert "http request" in types
    assert "mqtt-broker" in types
    tab = next(n for n in nodes if n["type"] == "tab")
    assert "demo" in tab["label"]


def test_build_http_flow_has_required_nodes():
    nodes = build_demo_flow("http-to-td")
    types = [n["type"] for n in nodes]
    assert "tab" in types
    assert "http in" in types
    assert "function" in types
    assert "http request" in types
    tab = next(n for n in nodes if n["type"] == "tab")
    assert "demo" in tab["label"]


def test_build_unknown_raises():
    with pytest.raises(KeyError):
        build_demo_flow("does-not-exist")


def test_merge_installs_into_empty():
    nodes = build_demo_flow("mqtt-to-td")
    out = merge_into_flows([], nodes)
    assert len(out) == len(nodes)


def test_merge_preserves_unrelated_tabs():
    nodes = build_demo_flow("mqtt-to-td")
    existing = [{"id": "my_tab", "type": "tab", "label": "user-flow"},
                {"id": "my_n1", "type": "function", "z": "my_tab"}]
    out = merge_into_flows(existing, nodes)
    labels = [n["label"] for n in out if n["type"] == "tab"]
    assert "user-flow" in labels
    assert any("mqtt" in l for l in labels)


def test_merge_is_idempotent():
    """Re-installing the same demo should replace, not duplicate."""
    nodes = build_demo_flow("mqtt-to-td")
    once = merge_into_flows([], nodes)
    twice = merge_into_flows(once, nodes)
    # The two tabs (one 'user-flow' + one mqtt demo) is 2; mqtt should NOT
    # appear twice. Non-tab mqtt nodes should also not duplicate (broker may).
    mqtt_tabs = [n for n in twice
                 if n["type"] == "tab" and "mqtt" in n["label"]]
    assert len(mqtt_tabs) == 1


def test_merge_installs_two_demos():
    a = build_demo_flow("mqtt-to-td")
    b = build_demo_flow("http-to-td")
    out = merge_into_flows([], a)
    out = merge_into_flows(out, b)
    installed = installed_demos(out)
    assert "mqtt-to-td" in installed
    assert "http-to-td" in installed


def test_installed_demos_empty_when_no_tab():
    assert installed_demos([]) == []