"""Test-suite wide fixtures.

Sets GATEWAY_DISABLE_AUTOCONNECT=1 so existing tests don't spend 30s in the
TDengine auto-connect retry loop (or accidentally hit a real TDengine on
localhost). Tests that explicitly exercise auto-connect can unset this var.
"""
import os

os.environ.setdefault("GATEWAY_DISABLE_AUTOCONNECT", "1")
os.environ.setdefault("GATEWAY_DISABLE_NODERED", "1")