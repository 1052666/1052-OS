import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from gateway.aiaas_bridge import (
    AIAAS_DEFAULT_TOPIC,
    AIAAS_METRICS,
    AiaasBridgeConfig,
    build_aiaas_mqtt_tasks,
)
from gateway.nodered_tags import build_tag_catalog
from gateway.server import app


class _FakeCollector:
    def __init__(self):
        self.tasks = {}
        self.started: list[str] = []
        self.stopped = False

    def add_task(self, task):
        self.tasks[task.id] = task

    def start_task(self, task_id):
        self.started.append(task_id)

    def stop_all(self):
        self.stopped = True


def test_build_aiaas_mqtt_tasks_maps_telemetry_fields_to_queryable_tags():
    tasks = build_aiaas_mqtt_tasks(AiaasBridgeConfig())

    assert len(tasks) == len(AIAAS_METRICS)
    do_task = next(task for task in tasks if task.id == "AIAAS_DO_MG_L")
    assert do_task.protocol == "mqtt"
    assert do_task.mq_topic == AIAAS_DEFAULT_TOPIC
    assert do_task.mq_payload == "json"
    assert do_task.mq_field == "do_mg_l"
    assert do_task.table == "raw_data"
    assert do_task.site == "demo"
    assert do_task.device == "aiaas_line_1_zone_1"
    assert do_task.col_map["metric"] == "do_mg_l"
    assert do_task.col_map["unit"] == "mg/L"


def test_aiaas_tags_expose_child_table_and_value_column_for_industrial_queries():
    tasks = {task.id: task for task in build_aiaas_mqtt_tasks(AiaasBridgeConfig())}

    tags = build_tag_catalog(tasks)
    do_tag = next(tag for tag in tags if tag["tag"] == "AIAAS_DO_MG_L")

    assert do_tag["table"] == "raw_data_AIAAS_DO_MG_L"
    assert do_tag["stable"] == "raw_data"
    assert do_tag["col"] == "v"
    assert do_tag["metric"] == "do_mg_l"
    assert do_tag["unit"] == "mg/L"


def test_aiaas_bridge_bootstrap_endpoint_registers_and_optionally_starts_tasks():
    import gateway.server as srv

    fake = _FakeCollector()
    srv._collector = fake

    with TestClient(app) as client:
        response = client.post(
            "/api/aiaas/bridge/bootstrap",
            json={
                "broker_host": "127.0.0.1",
                "broker_port": 1883,
                "topic": AIAAS_DEFAULT_TOPIC,
                "start": True,
            },
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["topic"] == AIAAS_DEFAULT_TOPIC
    assert len(body["tasks"]) == len(AIAAS_METRICS)
    assert "AIAAS_NH4N_MG_L" in fake.tasks
    assert "AIAAS_NH4N_MG_L" in fake.started
    assert any(tag["tag"] == "AIAAS_BLOWER_FREQUENCY_HZ" for tag in body["tags"])
