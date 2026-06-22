# 数据对接接口 Node-RED 实现说明

## 对应文档

- 原始文档：`数据对接接口(1).docx`
- 内容：报警信息数据推送 + 实时参数数据推送
- 推送方式：HTTP POST / JSON 数组

## 已实现接口

| 类型 | 文档地址 | 本地仿真地址 | Node-RED 节点 |
|---|---|---|---|
| 报警信息数据推送 | `/web_service/ws/cz_alarm/putMonitorData` | `http://127.0.0.1:5904/web_service/ws/cz_alarm/putMonitorData` | `生成报警信息数组` |
| 实时参数数据推送 | `/web_service/ws/cz_alarm/putMonitorParamData` | `http://127.0.0.1:5904/web_service/ws/cz_alarm/putMonitorParamData` | `生成实时参数数组` |

## 交付文件

| 文件 | 用途 |
|---|---|
| `docs/data-integration-nodered-flow.json` | Node-RED flow |
| `docs/data-integration-mock-platform.py` | 本地仿真接收平台 |
| 本说明 | 操作说明 |

## Node-RED flow

已导入当前嵌入式 Node-RED：

```text
http://localhost:10052/industrial-gateway/nodered/
```

Tab 名称：

```text
数据对接接口 仿真
```

配置节点：

```text
配置 qyid/baseUrl
```

当前配置：

```js
flow.set('di_qyid','588A7E39-4B56-486F-8430-C07705053259');
flow.set('di_baseUrl','http://127.0.0.1:5904/web_service/ws/cz_alarm');
```

正式接入时把 `di_baseUrl` 改成文档中的地址：

```text
http://1.1.1.102:82/web_service/ws/cz_alarm
```

## 报警信息数据推送

文档要求：

- 正常状态每分钟推送 1 次。
- 报警状态每 10 秒推送 1 次。
- 请求体是 JSON 数组。

当前 flow 节点：

| 节点 | 作用 |
|---|---|
| `正常状态报警心跳 每60秒` | 自动推送 `flag=0` 正常状态 |
| `手动推送正常状态 flag=0` | 手动触发正常状态 |
| `手动推送报警状态 flag=1` | 手动触发报警状态 |
| `生成报警信息数组` | 生成文档要求字段 |
| `POST 数据对接接口` | HTTP POST |

正常状态示例：

```json
[
  {
    "qyid": "588A7E39-4B56-486F-8430-C07705053259",
    "tankno": "BX10",
    "detectorno": "A253010",
    "riskname": "一号重大危险源",
    "flag": "0"
  }
]
```

报警状态示例：

```json
[
  {
    "qyid": "588A7E39-4B56-486F-8430-C07705053259",
    "tankno": "BX10",
    "detectorno": "A253010",
    "riskname": "一号重大危险源",
    "starttime": "2026-06-21 16:04:04",
    "grade": "04",
    "monitor_value": "96.8",
    "flag": "1"
  }
]
```

## 实时参数数据推送

文档要求：

- 每 5 分钟推送 1 次。
- 请求体是 JSON 数组。

当前 flow 节点：

| 节点 | 作用 |
|---|---|
| `实时参数 每5分钟` | 自动定时推送 |
| `手动推送实时参数` | 手动触发 |
| `生成实时参数数组` | 生成参数数组 |
| `POST 数据对接接口` | HTTP POST |

示例：

```json
[
  {
    "qyid": "588A7E39-4B56-486F-8430-C07705053259",
    "tankno": "BX10",
    "detectorno": "A253010",
    "monitor_value": "20.98"
  }
]
```

注意：文档示例里写成了 `monitor_value `，末尾多了一个空格。实际字段说明是 `monitor_value`，当前实现使用无空格的标准字段。

## 仿真平台

启动：

```bash
python3 /Users/easonliu/1052-OS/docs/data-integration-mock-platform.py --port 5904
```

查看：

```text
http://127.0.0.1:5904/
http://127.0.0.1:5904/api/status
```

返回成功格式：

```json
{
  "result": true,
  "msg": "成功"
}
```

## 已完成验证

已触发：

```text
初始化配置                  200 OK
手动推送正常状态 flag=0     200 OK
手动推送报警状态 flag=1     200 OK
手动推送实时参数            200 OK
```

Node-RED 状态：

```json
{
  "qyid": "588A7E39-4B56-486F-8430-C07705053259",
  "baseUrl": "http://127.0.0.1:5904/web_service/ws/cz_alarm",
  "counters": {
    "alarm": 3,
    "param": 2
  }
}
```

仿真平台状态：

```json
{
  "alarm_count": 3,
  "param_count": 2
}
```

## 接真实平台时需要修改

修改 Node-RED 节点：

```text
配置 qyid/baseUrl
```

替换：

```js
flow.set('di_qyid','信息院提供的企业id');
flow.set('di_baseUrl','http://1.1.1.102:82/web_service/ws/cz_alarm');
```

真实设备接入时替换数据生成节点：

| 当前节点 | 真实替换来源 |
|---|---|
| `生成报警信息数组` | 1052 报警中心 / PLC 报警 / Node-RED 报警判断结果 |
| `生成实时参数数组` | PLC / OPC UA / Modbus / MQTT 实时采集值 |

后半段 HTTP POST 和响应处理可以保留。