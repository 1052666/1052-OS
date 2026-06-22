# HJ212-2025 Node-RED 仿真实现说明

## 对应标准

- 标准号：`HJ 212—2025`
- 标准名称：`污染物自动监测监控系统数据传输技术要求`
- 发布日期：`2025-06-06`
- 实施日期：`2026-01-01`
- 替代：`HJ 212—2017`
- 原文文件：`W020250711505311328432(1).pdf`

## 定位

在保留 `HJ212-2017 仿真` flow 的基础上，新增独立的 `HJ212-2025 仿真`。本版本已按 PDF 原文校准以下关键点：

- `Flag=9` 表示 HJ 212—2025 且需要应答。
- 用电监控使用 `ST=44 + CN=2011`，不是新增独立 CN。
- 关键生产工况使用 `ST=45 + CN=2011`。
- VOCs 原始监测数据使用 `ST=27 + CN=2013`。
- 现场机信息使用 `CN=3020`。
- `9011` 是请求应答，不是设备注册。
- 数据命令 `2000～2999`、`1014`、`3020` 按原文属于应加密范围。
- 报文长度按 UTF-8 字节切片解析，支持 CP 中出现中文。

## 交付文件

| 文件 | 用途 |
|---|---|
| `docs/hj212-2025-nodered-flow.json` | HJ212-2025 Node-RED flow |
| `docs/hj212-2025-mock-platform.py` | HJ212-2025 本地仿真接收平台 |
| 本说明 | 操作说明和正式接入建议 |

## 和 2017 版的关系

保留 2017：

```text
docs/hj212-nodered-flow.json
docs/hj212-mock-platform.py
docs/hj212-nodered-guide.md
```

新增 2025：

```text
docs/hj212-2025-nodered-flow.json
docs/hj212-2025-mock-platform.py
docs/hj212-2025-nodered-guide.md
```

Node-RED tab 分开：

```text
HJ212-2017 仿真
HJ212-2025 仿真
```

## 当前配置

Node-RED 配置节点：

```text
配置 MN/PW/baseUrl/SM4
```

当前值：

```js
flow.set('hj212_2025_mn', '010000A8900016F000169DC0');
flow.set('hj212_2025_pw', '123456');
flow.set('hj212_2025_baseUrl', 'http://127.0.0.1:5906');
flow.set('hj212_2025_sm4Key', '0123456789abcdeffedcba9876543210');
```

`MN` 原文定义为“数采仪入网编码”，联网激活后由上位机根据 CPUID、MAC 等硬件指纹数据赋码，用于唯一标识一个数据传输设备；由 24 个字符组成，字符集为 `0～9,A～F`。

## 报文结构

HJ212-2025 仍采用：

```text
## + 4位数据段长度 + 数据段 + CRC + \r\n
```

数据段：

```text
QN=YYYYMMDDhhmmsszzz;
ST=系统编码;
CN=命令编码;
PW=访问密码;
MN=数采仪入网编码;
Flag=标志位;
CP=&&数据区&&
```

长度字段按数据段 UTF-8 字节长度计算，不包含 `##`、长度本身、CRC、包尾。

## Flag 版本位

原文说明 `Flag` 包含标准版本号、是否拆分包、是否应答：

| 位 | 含义 |
|---|---|
| `V5～V0` | 标准版本号 |
| `A` | 是否包含总包数/包号 |
| `D` | 是否需要应答 |

版本号：

| 版本位 | 标准 |
|---|---|
| `000000` | HJ/T 212—2005 |
| `000001` | HJ 212—2017 |
| `000010` | HJ 212—2025 |

当前统一使用：

```text
Flag=9
```

二进制：

```text
00001001
```

含义：

- 版本号：`000010`，HJ 212—2025
- 不包含分包号
- 需要应答

## 当前实现的 2025 原文业务

| 业务 | ST | CN | Node-RED 节点 | 说明 |
|---|---:|---:|---|---|
| 大气实时数据 | `31` | `2011` | `大气实时 ST=31 CN=2011` | 常规污染物实时数据 |
| 上传硬件序号 | `91` | `1001` | `上传硬件序号 CN=1001` | 初始化/入网前硬件指纹 |
| 上传现场机信息 | `31` | `3020` | `上传现场机信息 CN=3020` | 原文要求加密 |
| 用电监控 | `44` | `2011` | `用电监控 ST=44 CN=2011` | 生产/治理设施用电实时数据 |
| 关键生产工况 | `45` | `2011` | `关键工况 ST=45 CN=2011` | 工况标记实时数据 |
| 多媒体文件信息 | `31` | `2013` | `多媒体文件信息 附录H仿真` | 按附录 H 思路传文件元信息 |
| VOCs 原始监测数据 | `27` | `2013` | `VOC原始数据 ST=27 CN=2013` | 原始监测数据及谱图文件引用 |
| SM4 通道仿真 | `31` | `2011` | `SM4加密通道仿真 CN=2011` | 字段结构仿真，非真实 SM4 |

## 用电监控

原文示例使用：

```text
ST=44;CN=2011
```

生产设施用电：

```text
d20105-Rtd=220.20,d20105-Flag=N;
d20205-Rtd=220.90,d20205-Flag=N;
d20305-Rtd=221.10,d20305-Flag=N;
d20405-Rtd=0.24,d20405-Flag=N
```

治理设施用电：

```text
d30106-Rtd=220.20,d30106-Flag=N;
d30406-Rtd=0.04,d30406-Flag=N
```

当前 flow 同时模拟生产设施和治理设施用电参数。

## 关键生产工况

原文示例使用：

```text
ST=45;CN=2011
```

当前 CP：

```text
DataTime=yyyyMMddHHmmss;
p99101-Rtd=St,p99101-Flag=N;
p99102-Rtd=N,p99102-Flag=N;
p99103-Rtd=Sr,p99103-Flag=N
```

其中 `St/N/Sr` 等工况标记应按行业规则和原文数据标记表细化。

## VOCs 原始监测数据 / 谱图

原文表 15 明确：VOCs 类原始监测数据使用：

```text
CN=2013
```

上传内容包括：

- 甲烷、总烃、苯系物等周期性测量浓度值
- 测量保留时间
- 测量峰面积
- 测量峰高度
- 对应谱图文件

当前 flow 使用：

```text
ST=27;CN=2013;
CP=&&DataTime=...;SampleType=1;
v10101-Rtd=1.23,v10101-Flag=N;
v10101-RetentionTime=3.25;
v10101-PeakArea=120034;
v10101-PeakHeight=342;
SpectrumFile=VOC-yyyyMMddHHmmss.cdf&&
```

正式项目需要按平台备案的 VOC 因子编码和附录 H 文件传输要求修正谱图文件格式。

## 多媒体文件传输

原文新增附录 H：多媒体文件传输技术要求。

当前 flow 做的是“多媒体文件元信息仿真”：

```text
DataType=Multimedia;
DataTime=...;
FileType=jpg;
FileName=CAMERA-001-yyyyMMddHHmmss.jpg;
FileSize=128616;
Digest=SIMULATEDSHA256;
Url=http://127.0.0.1:5906/mock/CAMERA-001-yyyyMMddHHmmss.jpg;
VideoCode=CAMERA-001;
EventType=SmokeFire
```

这可对接前面粉尘涉爆项目里的海康抓拍图片，但正式版要按附录 H 的文件分片/校验/传输字段进一步实现。

## SM4 国密加密

原文要求：

| 项 | 要求 |
|---|---|
| 算法 | SM4 |
| 密钥长度 | 16 字节 / 128 位 |
| 工作模式 | ECB |
| 填充模式 | Nopadding |
| 加密范围 | 数据段中 `CP=&&` 到 `&&CRC校验码` 之间的字符 |

应加密命令：

| CN 范围/命令 | 说明 |
|---|---|
| `2000～2999` | 现场机向上位机发送的数据命令 |
| `1014` | 现场机获取新密钥 / 上位机设置新密钥 |
| `3020` | 现场机信息 |

当前实现仍是“SM4 通道仿真”：

```text
Alg=SM4;
Mode=ECB;
Padding=Nopadding;
KeyId=sim-key-001;
Cipher=<base64明文JSON仿真密文>
```

它用于打通字段结构、识别应加密命令、验证链路。正式项目下一步要接真实 SM4 库，且密钥必须进入 Node-RED credentials 或 1052 前端安全配置，不能写死在 function 节点。

## 本地仿真平台

启动：

```bash
python3 /Users/easonliu/1052-OS/docs/hj212-2025-mock-platform.py --port 5906
```

查看：

```text
http://127.0.0.1:5906/
http://127.0.0.1:5906/api/status
```

上传接口：

```text
POST http://127.0.0.1:5906/api/hj212-2025/upload
```

当前验证状态示例：

```json
{
  "profile": "HJ212-2025",
  "frame_count": 12,
  "init_count": 1,
  "terminal_info_count": 1,
  "electric_count": 1,
  "process_count": 1,
  "multimedia_count": 1,
  "voc_original_count": 1,
  "encrypted_count": 1
}
```

所有最近报文：

- `crc_ok=true`
- `flag.version=HJ 212-2025`
- 已覆盖 `31/2011`、`91/1001`、`31/3020`、`44/2011`、`45/2011`、`31/2013`、`27/2013`

## 最近项目如何升级到 2025 版

### 粉尘涉爆项目

| 原能力 | HJ212-2025 映射 |
|---|---|
| 粉尘浓度实时值 | `ST=31;CN=2011`，颗粒物/粉尘因子 `Rtd/Flag` |
| 除尘设备启停/电流 | `ST=44;CN=2011`，用电监控因子 `dxxxxx-Rtd/Flag` |
| 生产/治理设施工况 | `ST=45;CN=2011`，工况标记 `pxxxxx-Rtd/Flag` |
| 海康抓拍图片 | 附录 H 多媒体文件传输，当前可先传文件元信息 |
| 视频 AI 烟火识别 | 多媒体文件信息 + `EventType=SmokeFire` 扩展 |
| 设备信息 | `CN=3020` 现场机信息 |
| 安全传输 | 数据命令走 SM4-ECB/Nopadding |

### 数据对接接口项目

| 原字段 | HJ212-2025 映射 |
|---|---|
| `qyid` | 平台侧企业编码，和 `MN` 建绑定关系 |
| `detectorno` | 备案后的监测参数/点位编码 |
| `monitor_value` | `xxxxxx-Rtd` 或 `xxxxxx-Avg` |
| `flag=0/1` | `xxxxxx-Flag` 或报警/工况标记 |
| `starttime` | `DataTime` |
| `grade` | 可映射到扩展报警级别或多媒体事件字段 |

## 下一步

1. 接真实 SM4 算法，按 `SM4-ECB/Nopadding` 对原文指定范围加密。
2. 按附录 H 完成真实多媒体文件分片、校验、传输。
3. 把 `MN/PW/SM4Key/baseUrl/因子映射` 放入 1052 前端配置或 Node-RED credentials。
4. 给粉尘涉爆 flow 增加一条 HJ212-2025 输出支路，保留原粉尘涉爆 HTTP JSON/DES 支路。
5. 给数据对接接口 flow 增加 HJ212-2025 输出支路，保留原 JSON 数组支路。
