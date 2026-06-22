# 粉尘涉爆企业监测预警系统 V1.1 Node-RED 仿真实现

## 对应文档

- 原始接口文档：`粉尘涉爆企业监测预警系统数据上传接口文档V1.1.docx`
- 适用系统：河北省粉尘涉爆企业安全生产风险监测预警系统
- 平台正式地址：`http://121.28.252.222:6030/rabbitmqfcsb/`
- 本地仿真平台：`http://127.0.0.1:5902/rabbitmqfcsb/`

## 已实现接口

| 文档章节 | 接口 | Node-RED 节点 | 状态 |
|---|---|---|---|
| 2.1 | `/api/rtsData` | `实时数据仿真 每30秒` / `手动触发 rtsData` | 已实现 |
| 2.2 | `/api/eventsData` | `仿真报警：粉尘浓度超上上限` / `仿真消警：粉尘浓度恢复` | 已实现 |
| 2.3 | `/api/videosData` | `仿真视频报警：烟火识别` | 已实现 |

## 交付文件

| 文件 | 用途 |
|---|---|
| `docs/dust-explosion-nodered-flow-v1.1.json` | 可导入 Node-RED 的完整 flow |
| `docs/dust-explosion-mock-platform-v1.1.py` | 本地仿真接收平台，支持解密验证 rts/events/videos |
| 本说明 | 操作、调试、接真实平台说明 |

## 安全与加密

文档要求 `data` 字段加密，外层 `qybm` 明文。

加密流程：

```text
JSON 明文 → UTF-8 bytes → DES-CBC 加密 → Base64 → Hex 大写字符串
```

参数：

| 项 | 当前仿真值 |
|---|---|
| 企业编码 `qybm` | `012345678912` |
| 网关编码 `wgbm` | `01234567891201` |
| DES key | `ab23dcef` |
| IV | `12345678` |
| 仿真 baseUrl | `http://127.0.0.1:5902/rabbitmqfcsb` |

Node-RED 中使用 `crypto-js` 完成 DES-CBC 加密。

## 当前 Node-RED 导入状态

已导入到当前嵌入式 Node-RED：

```text
http://localhost:10052/industrial-gateway/nodered/
```

Flow tab：

```text
粉尘涉爆上传 v1.1 仿真
```

Node-RED 状态接口：

```text
http://127.0.0.1:1880/api/dust-v11/status
```

当前验证时返回过：

```json
{
  "qybm": "012345678912",
  "wgbm": "01234567891201",
  "baseUrl": "http://127.0.0.1:5902/rabbitmqfcsb",
  "counters": {
    "rts": 5,
    "events": 2,
    "videos": 1
  }
}
```

## 本地仿真平台

启动：

```bash
python3 /Users/easonliu/1052-OS/docs/dust-explosion-mock-platform-v1.1.py --port 5902
```

浏览器查看：

```text
http://127.0.0.1:5902/
http://127.0.0.1:5902/api/status
```

仿真平台会：

1. 接收 Node-RED POST 的外层 JSON。
2. 读取明文 `qybm` / `wgbm` / `img`。
3. 对 `data` 执行 Hex → Base64 → DES-CBC 解密。
4. 校验并展示明文结构。
5. 返回文档要求的成功响应：

```json
{"code": 200, "msg": "操作成功", "data": null}
```

## 仿真操作步骤

### 1. 打开 Node-RED

```text
http://localhost:10052/industrial-gateway/nodered/
```

进入 tab：

```text
粉尘涉爆上传 v1.1 仿真
```

### 2. 点击初始化配置

节点：

```text
初始化配置
```

它会设置：

- `qybm`
- `wgbm`
- `secretKey`
- `baseUrl`
- `videoCode`
- 三类计数器

### 3. 仿真实时数据

点击：

```text
手动触发 rtsData
```

或等待：

```text
实时数据仿真 每30秒
```

明文结构示例：

```json
{
  "qybm": "012345678912",
  "data": {
    "rts": [
      {"tnm": "0123456789120101001", "ts": "2026-06-21 08:10:34", "val": "27.20"},
      {"tnm": "0123456789120102001", "ts": "2026-06-21 08:10:34", "val": "50.54"}
    ]
  }
}
```

外层上传结构：

```json
{
  "qybm": "012345678912",
  "wgbm": "01234567891201",
  "data": "<DES加密后的HEX>"
}
```

### 4. 仿真报警与消警

报警：

```text
仿真报警：粉尘浓度超上上限
```

消警：

```text
仿真消警：粉尘浓度恢复
```

报警明文结构示例：

```json
{
  "qybm": "012345678912",
  "data": {
    "events": [
      {
        "ts": "2026-06-21 08:10:35",
        "oname": "0123456789120106001",
        "avx": "126.8000",
        "scd": 4,
        "threshold": 100,
        "content": "粉尘浓度超上上限报警，请立即联锁除尘并检查清扫"
      }
    ]
  }
}
```

消警 `scd=0`：

```json
{
  "scd": 0,
  "content": "粉尘浓度恢复正常，自动消警"
}
```

### 5. 仿真视频报警

点击：

```text
仿真视频报警：烟火识别
```

明文结构示例：

```json
{
  "qybm": "012345678912",
  "data": {
    "ts": "2026-06-21 08:10:37",
    "videoCode": "01234567891234567890",
    "alarmType": "SJ02001",
    "content": "视频AI识别到粉尘区域疑似烟火事件"
  }
}
```

外层额外带明文图片：

```json
{
  "qybm": "012345678912",
  "img": "<base64图片>",
  "data": "<DES加密后的HEX>"
}
```

## 已完成调试结果

已通过 Node-RED inject 节点触发完整仿真：

```text
rtsData            200 OK
eventsData alarm   200 OK
eventsData clear   200 OK
videosData         200 OK
```

仿真平台状态：

```json
{
  "rts_count": 9,
  "events_count": 4,
  "videos_count": 2
}
```

仿真平台解密后最近报文包含：

- `rtsData`：实时数据，含 `wgbm=01234567891201`。
- `eventsData`：报警 `scd=4`。
- `eventsData`：消警 `scd=0`。
- `videosData`：视频报警 `alarmType=SJ02001`，含明文 `img`。

## 接真实平台时需要改哪里

Node-RED tab 中修改节点：

```text
配置 qybm/key/baseUrl
```

把以下值替换成正式值：

```js
flow.set('qybm', '正式企业编码');
flow.set('wgbm', '正式企业编码01');
flow.set('secretKey', '省平台下发的8位DES秘钥');
flow.set('baseUrl', 'http://121.28.252.222:6030/rabbitmqfcsb');
flow.set('videoCode', '正式视频点位编码');
```

真实设备接入时替换三类仿真 inject：

| 当前仿真节点 | 真实替换来源 |
|---|---|
| `实时数据仿真 每30秒` | PLC / MQTT / OPC UA / Modbus 采集数据 |
| `仿真报警：粉尘浓度超上上限` | 报警判断节点或上位系统报警事件 |
| `仿真视频报警：烟火识别` | 视频 AI 平台事件 + 截图 base64 |

保留后半段：

```text
文档明文结构 → DES-CBC 加密 data 字段 → POST 平台接口 → 响应状态/debug
```

## 注意事项

1. DES key 必须是 8 字节。
2. IV 固定为 `12345678`。
3. `data` 是加密字段，`qybm` 是明文字段。
4. `rtsData` V1.1 增加了 `wgbm`，当前 flow 已带上。
5. `eventsData` 的 `content` 在 V1.1 为必传，当前 flow 已带上。
6. `/api/rtsData` 要打包上传多个检测器数据，不建议每个传感器单独 POST。
7. 当前仿真每 30 秒上传实时数据，正式按文档应不少于每 5 分钟 1 次，可按现场要求调整。
8. 正式平台地址是外网地址，切换前先确认网络、白名单、防火墙和企业编码/秘钥。