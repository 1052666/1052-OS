"""Registry of protocol drivers.

Adding a new protocol = drop a `gateway/drivers/<name>.py` that calls
`register(...)` at module load time. Nothing else needs to change.

The package's `__init__.py` walks this directory and imports every sibling
module so registration runs at package import time. `from gateway.drivers
import DRIVERS` therefore always sees every registered driver.
"""
from __future__ import annotations

from typing import Iterable

from gateway.drivers.base import Driver, DriverContext, get_driver_for


DRIVERS: dict[str, Driver] = {}


def register(driver: Driver) -> None:
    """Insert (or replace) a driver in the registry by its `name`.

    Idempotent: registering the same driver twice is a no-op.
    """
    if not getattr(driver, "name", None):
        raise ValueError(f"{driver!r} has no .name attribute")
    existing = DRIVERS.get(driver.name)
    if existing is driver:
        return
    DRIVERS[driver.name] = driver


def get_driver(name: str) -> Driver:
    """Return the driver for a protocol name. Raises KeyError if unknown."""
    return DRIVERS[name]


def try_driver(name: str) -> Driver | None:
    """Return the driver for a protocol name or None if not registered."""
    return DRIVERS.get(name)


def iter_drivers() -> Iterable[Driver]:
    """Iterate all registered drivers in registration order."""
    return list(DRIVERS.values())


def config_cls_for(name: str):
    """Return the Pydantic config class for a protocol name."""
    return DRIVERS[name].config_cls


def reset_for_tests() -> None:
    """Clear the registry — only for unit tests."""
    DRIVERS.clear()


__all__ = [
    "DRIVERS",
    "register",
    "get_driver",
    "try_driver",
    "iter_drivers",
    "config_cls_for",
    "reset_for_tests",
    "Driver",
    "DriverContext",
    "get_driver_for",
]
