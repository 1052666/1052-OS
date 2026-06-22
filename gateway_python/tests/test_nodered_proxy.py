import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.server import _nodered_ws_headers


def test_nodered_ws_headers_drop_browser_handshake_fields():
    headers = {
        "host": "127.0.0.1:8765",
        "connection": "Upgrade",
        "upgrade": "websocket",
        "sec-websocket-key": "browser-key",
        "sec-websocket-version": "13",
        "sec-websocket-extensions": "permessage-deflate",
        "origin": "http://127.0.0.1:5173",
        "cookie": "sid=abc",
        "x-forwarded-prefix": "/industrial-gateway/nodered",
    }

    forwarded = dict(_nodered_ws_headers(headers))

    assert "host" not in forwarded
    assert "connection" not in forwarded
    assert "upgrade" not in forwarded
    assert "sec-websocket-key" not in forwarded
    assert "sec-websocket-version" not in forwarded
    assert "sec-websocket-extensions" not in forwarded
    assert forwarded["origin"] == "http://127.0.0.1:5173"
    assert forwarded["cookie"] == "sid=abc"
    assert forwarded["x-forwarded-prefix"] == "/industrial-gateway/nodered"
