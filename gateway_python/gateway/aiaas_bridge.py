"""AIAAS precision aeration bridge helpers.

The bridge keeps 1052-OS in a read-only observer role: it subscribes to the
AIAAS PLC telemetry MQTT topic and maps each JSON field into a normal 1052
collector task so TDengine/industrial_* tools can query trends.
"""
from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, Field

from gateway.collector import CollectTask


AIAAS_DEFAULT_TOPIC = "aiaas/plc/line-1/zone-1/telemetry"
AIAAS_DEFAULT_SITE = "demo"
AIAAS_DEFAULT_DEVICE = "aiaas_line_1_zone_1"
AIAAS_DEFAULT_TABLE = "raw_data"


@dataclass(frozen=True)
class AiaasMetric:
    tag: str
    field: str
    unit: str
    label: str


AIAAS_METRICS: tuple[AiaasMetric, ...] = (
    AiaasMetric("AIAAS_DO_MG_L", "do_mg_l", "mg/L", "好氧区 DO"),
    AiaasMetric("AIAAS_NH4N_MG_L", "nh4n_mg_l", "mg/L", "出水 NH4-N"),
    AiaasMetric("AIAAS_NO3N_MG_L", "no3n_mg_l", "mg/L", "出水 NO3-N"),
    AiaasMetric("AIAAS_MLSS_MG_L", "mlss_mg_l", "mg/L", "MLSS"),
    AiaasMetric("AIAAS_FLOW_M3_H", "flow_m3_h", "m3/h", "进水流量"),
    AiaasMetric("AIAAS_AIR_FLOW_M3_MIN", "air_flow_m3_min", "m3/min", "曝气风量"),
    AiaasMetric("AIAAS_PRESSURE_KPA", "pressure_kpa", "kPa", "总管压力"),
    AiaasMetric("AIAAS_BLOWER_FREQUENCY_HZ", "blower_frequency_hz", "Hz", "鼓风机频率"),
    AiaasMetric("AIAAS_VALVE_OPENING_PCT", "valve_opening_pct", "%", "曝气阀开度"),
    AiaasMetric("AIAAS_ENERGY_KW", "energy_kw", "kW", "曝气能耗"),
    AiaasMetric("AIAAS_DO_SETPOINT_MG_L", "do_setpoint_mg_l", "mg/L", "DO 设定值"),
)


class AiaasBridgeConfig(BaseModel):
    broker_host: str = "127.0.0.1"
    broker_port: int = 1883
    username: str | None = None
    password: str | None = None
    topic: str = AIAAS_DEFAULT_TOPIC
    qos: int = Field(default=0, ge=0, le=2)
    site: str = AIAAS_DEFAULT_SITE
    device: str = AIAAS_DEFAULT_DEVICE
    table: str = AIAAS_DEFAULT_TABLE
    interval: float = Field(default=1.0, gt=0)
    start: bool = False


def build_aiaas_mqtt_tasks(config: AiaasBridgeConfig) -> list[CollectTask]:
    tasks: list[CollectTask] = []
    for metric in AIAAS_METRICS:
        tasks.append(
            CollectTask(
                id=metric.tag,
                protocol="mqtt",
                dtype="f32",
                mq_broker_host=config.broker_host,
                mq_broker_port=config.broker_port,
                mq_username=config.username,
                mq_password=config.password,
                mq_topic=config.topic,
                mq_qos=config.qos,
                mq_payload="json",
                mq_field=metric.field,
                mq_client_id=f"1052-aiaas-{metric.field}",
                table=config.table,
                interval=config.interval,
                site=config.site,
                device=config.device,
                col_map={
                    "metric": metric.field,
                    "unit": metric.unit,
                    "label": metric.label,
                    "source": "aiaas",
                    "advisory_only": "true",
                },
            )
        )
    return tasks
