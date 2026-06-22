"""Protocol-agnostic driver package.

Re-exports the registry so callers can write:

    from gateway.drivers import DRIVERS, get_driver, Driver, DriverContext

The registry is populated at import time by auto-discovering every sibling
module in this package; each driver module is expected to call
`register(...)` at module load time.
"""
from __future__ import annotations

import importlib
import pkgutil

from gateway.drivers.base import Driver, DriverContext, get_driver_for
from gateway.drivers.registry import (
    DRIVERS,
    config_cls_for,
    get_driver,
    iter_drivers,
    register,
    reset_for_tests,
    try_driver,
)


def _autoload() -> None:
    """Import every sibling module so driver modules self-register."""
    for mod_info in pkgutil.iter_modules(__path__):
        name = mod_info.name
        if name in ("base", "registry"):
            continue  # already loaded above
        importlib.import_module(f"{__name__}.{name}")


_autoload()


__all__ = [
    "DRIVERS",
    "Driver",
    "DriverContext",
    "get_driver",
    "get_driver_for",
    "try_driver",
    "iter_drivers",
    "register",
    "config_cls_for",
    "reset_for_tests",
]
