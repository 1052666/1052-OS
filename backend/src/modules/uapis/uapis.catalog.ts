import type { UapisApiDefinition, UapisCategory } from './uapis.types.js'

export const UAPIS_HOME = 'https://uapis.cn'
export const UAPIS_CONSOLE = 'https://uapis.cn/console'
export const UAPIS_PRICING = 'https://uapis.cn/pricing'
export const UAPIS_STATUS = 'https://uapis.cn/status'
export const UAPIS_BASE_URL = 'https://uapis.cn'
export const UAPIS_DOC_DECLARED_TOTAL = 92
export const UAPIS_DOC_EXPLICIT_TOTAL = 88

export const UAPIS_CATEGORIES: UapisCategory[] = [
  {
    "id": "bilibili",
    "name": "哔哩哔哩",
    "declaredCount": 5
  },
  {
    "id": "qq",
    "name": "QQ",
    "declaredCount": 3
  },
  {
    "id": "network",
    "name": "网络工具",
    "declaredCount": 10
  },
  {
    "id": "weather-time",
    "name": "天气与时间",
    "declaredCount": 6
  },
  {
    "id": "tracking",
    "name": "快递查询",
    "declaredCount": 3
  },
  {
    "id": "image",
    "name": "图片处理",
    "declaredCount": 9
  },
  {
    "id": "translate",
    "name": "翻译",
    "declaredCount": 4
  },
  {
    "id": "crypto",
    "name": "加密解密",
    "declaredCount": 11
  },
  {
    "id": "safety",
    "name": "敏感词检测",
    "declaredCount": 4
  },
  {
    "id": "webparse",
    "name": "网页解析",
    "declaredCount": 6
  },
  {
    "id": "misc",
    "name": "杂项",
    "declaredCount": 10
  },
  {
    "id": "game",
    "name": "游戏",
    "declaredCount": 5
  },
  {
    "id": "github",
    "name": "GitHub",
    "declaredCount": 2
  },
  {
    "id": "random",
    "name": "随机生成",
    "declaredCount": 4
  },
  {
    "id": "search",
    "name": "搜索",
    "declaredCount": 2
  },
  {
    "id": "status",
    "name": "状态",
    "declaredCount": 2
  },
  {
    "id": "clipzy",
    "name": "在线剪贴板",
    "declaredCount": 3
  },
  {
    "id": "meme",
    "name": "表情包",
    "declaredCount": 2
  }
]

export const UAPIS_APIS: UapisApiDefinition[] = [
  {
    "id": "get-social-bilibili-videoinfo",
    "categoryId": "bilibili",
    "categoryName": "哔哩哔哩",
    "order": 1,
    "name": "查询 B站视频",
    "method": "GET",
    "path": "/api/v1/social/bilibili/videoinfo",
    "description": "获取B站视频详细信息",
    "params": [
      {
        "name": "bvid",
        "type": "string",
        "required": true,
        "description": "视频BV号（如：BV1xx411c7mD）"
      }
    ],
    "bodyExample": "",
    "documentation": "【1. 查询 B站视频】\n接口：GET /api/v1/social/bilibili/videoinfo\n描述：获取B站视频详细信息\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ bvid        │ string │ 是     │ 视频BV号（如：BV1xx411c7mD）│\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n请求示例：\ncurl 'https://uapis.cn/api/v1/social/bilibili/videoinfo?bvid=BV1xx411c7mD'\n\n响应示例：\n{\n  \"code\": 200,\n  \"message\": \"success\",\n  \"data\": {\n    \"bvid\": \"BV1xx411c7mD\",\n    \"aid\": 123456789,\n    \"title\": \"视频标题\",\n    \"description\": \"视频简介\",\n    \"duration\": 3600,\n    \"view\": 100000,\n    \"danmaku\": 5000,\n    \"reply\": 1000,\n    \"favorite\": 2000,\n    \"coin\": 1500,\n    \"share\": 500,\n    \"like\": 8000,\n    \"owner\": {\n      \"mid\": 123456,\n      \"name\": \"UP主名称\",\n      \"face\": \"头像URL\"\n    },\n    \"pubdate\": 1234567890\n  }\n}\n\n---"
  },
  {
    "id": "get-social-bilibili-userinfo",
    "categoryId": "bilibili",
    "categoryName": "哔哩哔哩",
    "order": 2,
    "name": "查询 B站用户",
    "method": "GET",
    "path": "/api/v1/social/bilibili/userinfo",
    "description": "获取B站用户信息",
    "params": [
      {
        "name": "mid",
        "type": "string",
        "required": true,
        "description": "用户ID（mid）"
      }
    ],
    "bodyExample": "",
    "documentation": "【2. 查询 B站用户】\n接口：GET /api/v1/social/bilibili/userinfo\n描述：获取B站用户信息\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ mid         │ string │ 是     │ 用户ID（mid）               │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n请求示例：\ncurl 'https://uapis.cn/api/v1/social/bilibili/userinfo?mid=123456'\n\n响应示例：\n{\n  \"code\": 200,\n  \"message\": \"success\",\n  \"data\": {\n    \"mid\": 123456,\n    \"name\": \"用户昵称\",\n    \"sex\": \"男\",\n    \"face\": \"头像URL\",\n    \"sign\": \"个性签名\",\n    \"level\": 6,\n    \"fans\": 10000,\n    \"following\": 500,\n    \"archive_count\": 100\n  }\n}\n\n---"
  },
  {
    "id": "get-social-bilibili-liveroom",
    "categoryId": "bilibili",
    "categoryName": "哔哩哔哩",
    "order": 3,
    "name": "查询 B站直播间",
    "method": "GET",
    "path": "/api/v1/social/bilibili/liveroom",
    "description": "获取B站直播间信息",
    "params": [
      {
        "name": "room_id",
        "type": "string",
        "required": true,
        "description": "直播间ID"
      }
    ],
    "bodyExample": "",
    "documentation": "【3. 查询 B站直播间】\n接口：GET /api/v1/social/bilibili/liveroom\n描述：获取B站直播间信息\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ room_id     │ string │ 是     │ 直播间ID                    │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-social-bilibili-archives",
    "categoryId": "bilibili",
    "categoryName": "哔哩哔哩",
    "order": 4,
    "name": "查询 B站投稿",
    "method": "GET",
    "path": "/api/v1/social/bilibili/archives",
    "description": "获取UP主投稿视频列表",
    "params": [
      {
        "name": "mid",
        "type": "string",
        "required": true,
        "description": "用户ID（mid）"
      },
      {
        "name": "page",
        "type": "int",
        "required": false,
        "description": "页码，默认1"
      },
      {
        "name": "page_size",
        "type": "int",
        "required": false,
        "description": "每页数量，默认30"
      }
    ],
    "bodyExample": "",
    "documentation": "【4. 查询 B站投稿】\n接口：GET /api/v1/social/bilibili/archives\n描述：获取UP主投稿视频列表\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ mid         │ string │ 是     │ 用户ID（mid）               │\n│ page        │ int    │ 否     │ 页码，默认1                 │\n│ page_size   │ int    │ 否     │ 每页数量，默认30            │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-social-bilibili-replies",
    "categoryId": "bilibili",
    "categoryName": "哔哩哔哩",
    "order": 5,
    "name": "查询 B站评论",
    "method": "GET",
    "path": "/api/v1/social/bilibili/replies",
    "description": "获取视频评论列表",
    "params": [
      {
        "name": "oid",
        "type": "string",
        "required": true,
        "description": "视频aid"
      },
      {
        "name": "type",
        "type": "int",
        "required": false,
        "description": "类型，默认1（视频）"
      },
      {
        "name": "page",
        "type": "int",
        "required": false,
        "description": "页码"
      }
    ],
    "bodyExample": "",
    "documentation": "【5. 查询 B站评论】\n接口：GET /api/v1/social/bilibili/replies\n描述：获取视频评论列表\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ oid         │ string │ 是     │ 视频aid                     │\n│ type        │ int    │ 否     │ 类型，默认1（视频）         │\n│ page        │ int    │ 否     │ 页码                        │\n└─────────────┴────────┴────────┴─────────────────────────────┘"
  },
  {
    "id": "get-social-qq-userinfo",
    "categoryId": "qq",
    "categoryName": "QQ",
    "order": 1,
    "name": "查询 QQ 信息",
    "method": "GET",
    "path": "/api/v1/social/qq/userinfo",
    "description": "获取QQ用户基本信息【独家接口】",
    "params": [
      {
        "name": "qq",
        "type": "string",
        "required": true,
        "description": "QQ号"
      }
    ],
    "bodyExample": "",
    "documentation": "【1. 查询 QQ 信息】\n接口：GET /api/v1/social/qq/userinfo\n描述：获取QQ用户基本信息【独家接口】\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ qq          │ string │ 是     │ QQ号                        │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n请求示例：\ncurl 'https://uapis.cn/api/v1/social/qq/userinfo?qq=123456789'\n\n响应示例：\n{\n  \"code\": 200,\n  \"message\": \"success\",\n  \"data\": {\n    \"qq\": \"123456789\",\n    \"nickname\": \"昵称\",\n    \"avatar\": \"头像URL\",\n    \"level\": 64,\n    \"vip\": true\n  }\n}\n\n---"
  },
  {
    "id": "get-social-qq-groupinfo",
    "categoryId": "qq",
    "categoryName": "QQ",
    "order": 2,
    "name": "查询 QQ 群信息",
    "method": "GET",
    "path": "/api/v1/social/qq/groupinfo",
    "description": "获取QQ群基本信息【独家接口】",
    "params": [
      {
        "name": "group_id",
        "type": "string",
        "required": true,
        "description": "QQ群号"
      }
    ],
    "bodyExample": "",
    "documentation": "【2. 查询 QQ 群信息】\n接口：GET /api/v1/social/qq/groupinfo\n描述：获取QQ群基本信息【独家接口】\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ group_id    │ string │ 是     │ QQ群号                      │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-image-motou",
    "categoryId": "qq",
    "categoryName": "QQ",
    "order": 3,
    "name": "生成摸摸头GIF (QQ号)",
    "method": "GET",
    "path": "/api/v1/image/motou",
    "description": "根据QQ号生成摸摸头GIF动图【独家接口】",
    "params": [
      {
        "name": "qq",
        "type": "string",
        "required": true,
        "description": "QQ号"
      }
    ],
    "bodyExample": "",
    "documentation": "【3. 生成摸摸头GIF (QQ号)】\n接口：GET /api/v1/image/motou\n描述：根据QQ号生成摸摸头GIF动图【独家接口】\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ qq          │ string │ 是     │ QQ号                        │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n请求示例：\ncurl 'https://uapis.cn/api/v1/image/motou?qq=123456789' --output motou.gif"
  },
  {
    "id": "get-network-ipinfo",
    "categoryId": "network",
    "categoryName": "网络工具",
    "order": 1,
    "name": "查询 IP",
    "method": "GET",
    "path": "/api/v1/network/ipinfo",
    "description": "查询IP地址归属地信息",
    "params": [
      {
        "name": "ip",
        "type": "string",
        "required": false,
        "description": "IP地址或域名，不传则查询客户端IP"
      },
      {
        "name": "source",
        "type": "string",
        "required": false,
        "description": "数据源：standard/commercial"
      }
    ],
    "bodyExample": "",
    "documentation": "【1. 查询 IP】\n接口：GET /api/v1/network/ipinfo\n描述：查询IP地址归属地信息\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ ip          │ string │ 否     │ IP地址或域名，不传则查询客户端IP│\n│ source      │ string │ 否     │ 数据源：standard/commercial │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n请求示例：\ncurl 'https://uapis.cn/api/v1/network/ipinfo?ip=8.8.8.8'\n\n响应示例：\n{\n  \"code\": 200,\n  \"message\": \"success\",\n  \"data\": {\n    \"ip\": \"8.8.8.8\",\n    \"country\": \"美国\",\n    \"province\": \"加利福尼亚州\",\n    \"city\": \"芒廷维尤\",\n    \"isp\": \"Google\",\n    \"latitude\": 37.386,\n    \"longitude\": -122.0838\n  }\n}\n\n---"
  },
  {
    "id": "get-network-myip",
    "categoryId": "network",
    "categoryName": "网络工具",
    "order": 2,
    "name": "查询我的 IP",
    "method": "GET",
    "path": "/api/v1/network/myip",
    "description": "获取客户端公网IP地址",
    "params": [],
    "bodyExample": "",
    "documentation": "【2. 查询我的 IP】\n接口：GET /api/v1/network/myip\n描述：获取客户端公网IP地址\n\n请求参数：无\n\n请求示例：\ncurl 'https://uapis.cn/api/v1/network/myip'\n\n响应示例：\n{\n  \"code\": 200,\n  \"message\": \"success\",\n  \"data\": {\n    \"ip\": \"123.123.123.123\"\n  }\n}\n\n---"
  },
  {
    "id": "get-network-ping",
    "categoryId": "network",
    "categoryName": "网络工具",
    "order": 3,
    "name": "Ping 主机",
    "method": "GET",
    "path": "/api/v1/network/ping",
    "description": "测试主机连通性",
    "params": [
      {
        "name": "host",
        "type": "string",
        "required": true,
        "description": "主机名或IP地址"
      },
      {
        "name": "count",
        "type": "int",
        "required": false,
        "description": "Ping次数，默认4"
      }
    ],
    "bodyExample": "",
    "documentation": "【3. Ping 主机】\n接口：GET /api/v1/network/ping\n描述：测试主机连通性\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ host        │ string │ 是     │ 主机名或IP地址              │\n│ count       │ int    │ 否     │ Ping次数，默认4             │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n请求示例：\ncurl 'https://uapis.cn/api/v1/network/ping?host=google.com'\n\n---"
  },
  {
    "id": "get-network-dns",
    "categoryId": "network",
    "categoryName": "网络工具",
    "order": 4,
    "name": "执行DNS解析查询",
    "method": "GET",
    "path": "/api/v1/network/dns",
    "description": "查询域名DNS记录",
    "params": [
      {
        "name": "domain",
        "type": "string",
        "required": true,
        "description": "域名"
      },
      {
        "name": "type",
        "type": "string",
        "required": false,
        "description": "记录类型：A/AAAA/MX/CNAME等"
      }
    ],
    "bodyExample": "",
    "documentation": "【4. 执行DNS解析查询】\n接口：GET /api/v1/network/dns\n描述：查询域名DNS记录\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ domain      │ string │ 是     │ 域名                        │\n│ type        │ string │ 否     │ 记录类型：A/AAAA/MX/CNAME等 │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n请求示例：\ncurl 'https://uapis.cn/api/v1/network/dns?domain=google.com&type=A'\n\n---"
  },
  {
    "id": "get-network-icp",
    "categoryId": "network",
    "categoryName": "网络工具",
    "order": 5,
    "name": "查询域名ICP备案信息",
    "method": "GET",
    "path": "/api/v1/network/icp",
    "description": "查询网站ICP备案信息",
    "params": [
      {
        "name": "domain",
        "type": "string",
        "required": true,
        "description": "域名"
      }
    ],
    "bodyExample": "",
    "documentation": "【5. 查询域名ICP备案信息】\n接口：GET /api/v1/network/icp\n描述：查询网站ICP备案信息\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ domain      │ string │ 是     │ 域名                        │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n请求示例：\ncurl 'https://uapis.cn/api/v1/network/icp?domain=baidu.com'\n\n---"
  },
  {
    "id": "get-network-whois",
    "categoryId": "network",
    "categoryName": "网络工具",
    "order": 6,
    "name": "查询域名的WHOIS注册信息",
    "method": "GET",
    "path": "/api/v1/network/whois",
    "description": "查询域名Whois信息",
    "params": [
      {
        "name": "domain",
        "type": "string",
        "required": true,
        "description": "域名"
      }
    ],
    "bodyExample": "",
    "documentation": "【6. 查询域名的WHOIS注册信息】\n接口：GET /api/v1/network/whois\n描述：查询域名Whois信息\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ domain      │ string │ 是     │ 域名                        │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-network-urlstatus",
    "categoryId": "network",
    "categoryName": "网络工具",
    "order": 7,
    "name": "检查URL的可访问性状态",
    "method": "GET",
    "path": "/api/v1/network/urlstatus",
    "description": "检测URL是否可访问",
    "params": [
      {
        "name": "url",
        "type": "string",
        "required": true,
        "description": "要检测的URL"
      }
    ],
    "bodyExample": "",
    "documentation": "【7. 检查URL的可访问性状态】\n接口：GET /api/v1/network/urlstatus\n描述：检测URL是否可访问\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ url         │ string │ 是     │ 要检测的URL                 │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-network-wxdomain",
    "categoryId": "network",
    "categoryName": "网络工具",
    "order": 8,
    "name": "检查域名在微信中的访问状态",
    "method": "GET",
    "path": "/api/v1/network/wxdomain",
    "description": "检测域名在微信中是否被封禁",
    "params": [
      {
        "name": "domain",
        "type": "string",
        "required": true,
        "description": "域名"
      }
    ],
    "bodyExample": "",
    "documentation": "【8. 检查域名在微信中的访问状态】\n接口：GET /api/v1/network/wxdomain\n描述：检测域名在微信中是否被封禁\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ domain      │ string │ 是     │ 域名                        │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-network-portscan",
    "categoryId": "network",
    "categoryName": "网络工具",
    "order": 9,
    "name": "端口扫描",
    "method": "GET",
    "path": "/api/v1/network/portscan",
    "description": "扫描主机开放端口",
    "params": [
      {
        "name": "host",
        "type": "string",
        "required": true,
        "description": "主机名或IP"
      },
      {
        "name": "ports",
        "type": "string",
        "required": false,
        "description": "端口列表，如：80,443,8080"
      }
    ],
    "bodyExample": "",
    "documentation": "【9. 端口扫描】\n接口：GET /api/v1/network/portscan\n描述：扫描主机开放端口\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ host        │ string │ 是     │ 主机名或IP                  │\n│ ports       │ string │ 否     │ 端口列表，如：80,443,8080   │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-network-pingmyip",
    "categoryId": "network",
    "categoryName": "网络工具",
    "order": 10,
    "name": "Ping 我的 IP",
    "method": "GET",
    "path": "/api/v1/network/pingmyip",
    "description": "Ping客户端IP地址",
    "params": [],
    "bodyExample": "",
    "documentation": "【10. Ping 我的 IP】\n接口：GET /api/v1/network/pingmyip\n描述：Ping客户端IP地址"
  },
  {
    "id": "get-misc-weather",
    "categoryId": "weather-time",
    "categoryName": "天气与时间",
    "order": 1,
    "name": "查询天气",
    "method": "GET",
    "path": "/api/v1/misc/weather",
    "description": "获取实时天气数据",
    "params": [
      {
        "name": "city",
        "type": "string",
        "required": true,
        "description": "城市名称（如：北京、上海）"
      },
      {
        "name": "cityid",
        "type": "string",
        "required": false,
        "description": "城市ID"
      }
    ],
    "bodyExample": "",
    "documentation": "【1. 查询天气】\n接口：GET /api/v1/misc/weather\n描述：获取实时天气数据\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ city        │ string │ 是     │ 城市名称（如：北京、上海）  │\n│ cityid      │ string │ 否     │ 城市ID                      │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n请求示例：\ncurl 'https://uapis.cn/api/v1/misc/weather?city=北京'\n\n响应示例：\n{\n  \"code\": 200,\n  \"message\": \"success\",\n  \"data\": {\n    \"city\": \"北京\",\n    \"temperature\": \"25\",\n    \"weather\": \"晴\",\n    \"humidity\": \"45%\",\n    \"wind\": \"东南风3级\",\n    \"air_quality\": \"优\",\n    \"update_time\": \"2026-04-21 20:00\"\n  }\n}\n\n---"
  },
  {
    "id": "get-misc-worldtime",
    "categoryId": "weather-time",
    "categoryName": "天气与时间",
    "order": 2,
    "name": "查询世界时间",
    "method": "GET",
    "path": "/api/v1/misc/worldtime",
    "description": "查询世界各地时间",
    "params": [
      {
        "name": "city",
        "type": "string",
        "required": false,
        "description": "城市名（如：Tokyo、NewYork）"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "description": "时区（如：Asia/Tokyo）"
      }
    ],
    "bodyExample": "",
    "documentation": "【2. 查询世界时间】\n接口：GET /api/v1/misc/worldtime\n描述：查询世界各地时间\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ city        │ string │ 否     │ 城市名（如：Tokyo、NewYork）│\n│ timezone    │ string │ 否     │ 时区（如：Asia/Tokyo）      │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-misc-lunartime",
    "categoryId": "weather-time",
    "categoryName": "天气与时间",
    "order": 3,
    "name": "查询农历时间",
    "method": "GET",
    "path": "/api/v1/misc/lunartime",
    "description": "获取农历日期信息",
    "params": [
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "日期，格式：YYYY-MM-DD"
      }
    ],
    "bodyExample": "",
    "documentation": "【3. 查询农历时间】\n接口：GET /api/v1/misc/lunartime\n描述：获取农历日期信息\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ date        │ string │ 否     │ 日期，格式：YYYY-MM-DD      │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-convert-unixtime",
    "categoryId": "weather-time",
    "categoryName": "天气与时间",
    "order": 4,
    "name": "时间戳转换",
    "method": "GET",
    "path": "/api/v1/convert/unixtime",
    "description": "时间戳与日期互转",
    "params": [
      {
        "name": "timestamp",
        "type": "long",
        "required": false,
        "description": "时间戳（秒/毫秒）"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "日期字符串"
      }
    ],
    "bodyExample": "",
    "documentation": "【4. 时间戳转换】\n接口：GET /api/v1/convert/unixtime\n描述：时间戳与日期互转\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ timestamp   │ long   │ 否     │ 时间戳（秒/毫秒）           │\n│ date        │ string │ 否     │ 日期字符串                  │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-misc-holiday-calendar",
    "categoryId": "weather-time",
    "categoryName": "天气与时间",
    "order": 5,
    "name": "查询节假日与万年历",
    "method": "GET",
    "path": "/api/v1/misc/holiday/calendar",
    "description": "查询节假日信息",
    "params": [
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "日期，格式：YYYY-MM-DD"
      },
      {
        "name": "year",
        "type": "int",
        "required": false,
        "description": "年份"
      }
    ],
    "bodyExample": "",
    "documentation": "【5. 查询节假日与万年历】\n接口：GET /api/v1/misc/holiday/calendar\n描述：查询节假日信息\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ date        │ string │ 否     │ 日期，格式：YYYY-MM-DD      │\n│ year        │ int    │ 否     │ 年份                        │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "post-misc-date-diff",
    "categoryId": "weather-time",
    "categoryName": "天气与时间",
    "order": 6,
    "name": "计算两个日期之间的时间差值",
    "method": "POST",
    "path": "/api/v1/misc/date/diff",
    "description": "计算日期差",
    "params": [],
    "bodyExample": "{\n  \"start_date\": \"2026-01-01\",\n  \"end_date\": \"2026-04-21\"\n}",
    "documentation": "【6. 计算两个日期之间的时间差值】\n接口：POST /api/v1/misc/date/diff\n描述：计算日期差\n\n请求参数（JSON Body）：\n{\n  \"start_date\": \"2026-01-01\",\n  \"end_date\": \"2026-04-21\"\n}"
  },
  {
    "id": "get-misc-tracking-query",
    "categoryId": "tracking",
    "categoryName": "快递查询",
    "order": 1,
    "name": "查询快递物流信息",
    "method": "GET",
    "path": "/api/v1/misc/tracking/query",
    "description": "查询快递物流轨迹",
    "params": [
      {
        "name": "no",
        "type": "string",
        "required": true,
        "description": "快递单号"
      },
      {
        "name": "carrier",
        "type": "string",
        "required": false,
        "description": "快递公司代码（不传自动识别）"
      }
    ],
    "bodyExample": "",
    "documentation": "【1. 查询快递物流信息】\n接口：GET /api/v1/misc/tracking/query\n描述：查询快递物流轨迹\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ no          │ string │ 是     │ 快递单号                    │\n│ carrier     │ string │ 否     │ 快递公司代码（不传自动识别）│\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n请求示例：\ncurl 'https://uapis.cn/api/v1/misc/tracking/query?no=SF1234567890'\n\n响应示例：\n{\n  \"code\": 200,\n  \"message\": \"success\",\n  \"data\": {\n    \"no\": \"SF1234567890\",\n    \"carrier\": \"顺丰速运\",\n    \"status\": \"运输中\",\n    \"traces\": [\n      {\n        \"time\": \"2026-04-21 10:00\",\n        \"context\": \"快件已发出\"\n      },\n      {\n        \"time\": \"2026-04-21 12:00\",\n        \"context\": \"快件已到达北京转运中心\"\n      }\n    ]\n  }\n}\n\n---"
  },
  {
    "id": "get-misc-tracking-detect",
    "categoryId": "tracking",
    "categoryName": "快递查询",
    "order": 2,
    "name": "识别快递公司",
    "method": "GET",
    "path": "/api/v1/misc/tracking/detect",
    "description": "根据单号识别快递公司",
    "params": [
      {
        "name": "no",
        "type": "string",
        "required": true,
        "description": "快递单号"
      }
    ],
    "bodyExample": "",
    "documentation": "【2. 识别快递公司】\n接口：GET /api/v1/misc/tracking/detect\n描述：根据单号识别快递公司\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ no          │ string │ 是     │ 快递单号                    │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-misc-tracking-carriers",
    "categoryId": "tracking",
    "categoryName": "快递查询",
    "order": 3,
    "name": "获取支持的快递公司列表",
    "method": "GET",
    "path": "/api/v1/misc/tracking/carriers",
    "description": "获取支持的快递公司",
    "params": [],
    "bodyExample": "",
    "documentation": "【3. 获取支持的快递公司列表】\n接口：GET /api/v1/misc/tracking/carriers\n描述：获取支持的快递公司"
  },
  {
    "id": "get-image-qrcode",
    "categoryId": "image",
    "categoryName": "图片处理",
    "order": 1,
    "name": "生成二维码",
    "method": "GET",
    "path": "/api/v1/image/qrcode",
    "description": "生成二维码图片",
    "params": [
      {
        "name": "text",
        "type": "string",
        "required": true,
        "description": "二维码内容"
      },
      {
        "name": "size",
        "type": "int",
        "required": false,
        "description": "尺寸，默认200"
      },
      {
        "name": "margin",
        "type": "int",
        "required": false,
        "description": "边距，默认10"
      }
    ],
    "bodyExample": "",
    "documentation": "【1. 生成二维码】\n接口：GET /api/v1/image/qrcode\n描述：生成二维码图片\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ text        │ string │ 是     │ 二维码内容                  │\n│ size        │ int    │ 否     │ 尺寸，默认200               │\n│ margin      │ int    │ 否     │ 边距，默认10                │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n请求示例：\ncurl 'https://uapis.cn/api/v1/image/qrcode?text=https://example.com' --output qr.png\n\n---"
  },
  {
    "id": "get-image-tobase64",
    "categoryId": "image",
    "categoryName": "图片处理",
    "order": 2,
    "name": "图片转 Base64",
    "method": "GET",
    "path": "/api/v1/image/tobase64",
    "description": "将图片转换为Base64编码",
    "params": [
      {
        "name": "url",
        "type": "string",
        "required": true,
        "description": "图片URL"
      }
    ],
    "bodyExample": "",
    "documentation": "【2. 图片转 Base64】\n接口：GET /api/v1/image/tobase64\n描述：将图片转换为Base64编码\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ url         │ string │ 是     │ 图片URL                     │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "post-image-compress",
    "categoryId": "image",
    "categoryName": "图片处理",
    "order": 3,
    "name": "无损压缩图片",
    "method": "POST",
    "path": "/api/v1/image/compress",
    "description": "无损压缩图片",
    "params": [],
    "bodyExample": "{\n  \"image\": \"base64编码的图片\",\n  \"quality\": 80\n}",
    "documentation": "【3. 无损压缩图片】\n接口：POST /api/v1/image/compress\n描述：无损压缩图片\n\n请求参数（JSON Body）：\n{\n  \"image\": \"base64编码的图片\",\n  \"quality\": 80\n}\n\n---"
  },
  {
    "id": "post-image-ocr",
    "categoryId": "image",
    "categoryName": "图片处理",
    "order": 4,
    "name": "通用 OCR 文字识别",
    "method": "POST",
    "path": "/api/v1/image/ocr",
    "description": "识别图片中的文字",
    "params": [],
    "bodyExample": "{\n  \"image\": \"base64编码的图片或图片URL\"\n}",
    "documentation": "【4. 通用 OCR 文字识别】\n接口：POST /api/v1/image/ocr\n描述：识别图片中的文字\n\n请求参数（JSON Body）：\n{\n  \"image\": \"base64编码的图片或图片URL\"\n}\n\n---"
  },
  {
    "id": "get-image-bing-daily",
    "categoryId": "image",
    "categoryName": "图片处理",
    "order": 5,
    "name": "获取必应每日壁纸",
    "method": "GET",
    "path": "/api/v1/image/bing/daily",
    "description": "获取必应每日壁纸",
    "params": [
      {
        "name": "idx",
        "type": "int",
        "required": false,
        "description": "天数偏移，0为今天"
      },
      {
        "name": "n",
        "type": "int",
        "required": false,
        "description": "数量，默认1"
      }
    ],
    "bodyExample": "",
    "documentation": "【5. 获取必应每日壁纸】\n接口：GET /api/v1/image/bing/daily\n描述：获取必应每日壁纸\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ idx         │ int    │ 否     │ 天数偏移，0为今天           │\n│ n           │ int    │ 否     │ 数量，默认1                 │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-image-bing-daily-history",
    "categoryId": "image",
    "categoryName": "图片处理",
    "order": 6,
    "name": "查询必应壁纸历史",
    "method": "GET",
    "path": "/api/v1/image/bing/daily/history",
    "description": "获取历史壁纸列表",
    "params": [],
    "bodyExample": "",
    "documentation": "【6. 查询必应壁纸历史】\n接口：GET /api/v1/image/bing/daily/history\n描述：获取历史壁纸列表\n\n---"
  },
  {
    "id": "post-image-svg",
    "categoryId": "image",
    "categoryName": "图片处理",
    "order": 7,
    "name": "SVG转图片",
    "method": "POST",
    "path": "/api/v1/image/svg",
    "description": "将SVG转换为PNG图片",
    "params": [],
    "bodyExample": "",
    "documentation": "【7. SVG转图片】\n接口：POST /api/v1/image/svg\n描述：将SVG转换为PNG图片\n\n---"
  },
  {
    "id": "post-image-frombase64",
    "categoryId": "image",
    "categoryName": "图片处理",
    "order": 8,
    "name": "通过Base64编码上传图片",
    "method": "POST",
    "path": "/api/v1/image/frombase64",
    "description": "上传Base64编码的图片",
    "params": [],
    "bodyExample": "",
    "documentation": "【8. 通过Base64编码上传图片】\n接口：POST /api/v1/image/frombase64\n描述：上传Base64编码的图片\n\n---"
  },
  {
    "id": "post-image-decode",
    "categoryId": "image",
    "categoryName": "图片处理",
    "order": 9,
    "name": "解码并缩放图片",
    "method": "POST",
    "path": "/api/v1/image/decode",
    "description": "解码并缩放图片",
    "params": [],
    "bodyExample": "",
    "documentation": "【9. 解码并缩放图片】\n接口：POST /api/v1/image/decode\n描述：解码并缩放图片"
  },
  {
    "id": "post-ai-translate",
    "categoryId": "translate",
    "categoryName": "翻译",
    "order": 1,
    "name": "AI智能翻译",
    "method": "POST",
    "path": "/api/v1/ai/translate",
    "description": "AI驱动的智能翻译",
    "params": [],
    "bodyExample": "{\n  \"text\": \"待翻译文本\",\n  \"from\": \"zh\",\n  \"to\": \"en\"\n}",
    "documentation": "【1. AI智能翻译】\n接口：POST /api/v1/ai/translate\n描述：AI驱动的智能翻译\n\n请求参数（JSON Body）：\n{\n  \"text\": \"待翻译文本\",\n  \"from\": \"zh\",\n  \"to\": \"en\"\n}\n\n请求示例：\ncurl -X POST 'https://uapis.cn/api/v1/ai/translate' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"text\":\"你好世界\",\"from\":\"zh\",\"to\":\"en\"}'\n\n响应示例：\n{\n  \"code\": 200,\n  \"message\": \"success\",\n  \"data\": {\n    \"text\": \"你好世界\",\n    \"translated\": \"Hello World\",\n    \"from\": \"zh\",\n    \"to\": \"en\"\n  }\n}\n\n---"
  },
  {
    "id": "get-ai-translate-languages",
    "categoryId": "translate",
    "categoryName": "翻译",
    "order": 2,
    "name": "AI翻译配置",
    "method": "GET",
    "path": "/api/v1/ai/translate/languages",
    "description": "获取支持的语言列表",
    "params": [],
    "bodyExample": "",
    "documentation": "【2. AI翻译配置】\n接口：GET /api/v1/ai/translate/languages\n描述：获取支持的语言列表\n\n---"
  },
  {
    "id": "post-translate-stream",
    "categoryId": "translate",
    "categoryName": "翻译",
    "order": 3,
    "name": "流式翻译（中英互译）",
    "method": "POST",
    "path": "/api/v1/translate/stream",
    "description": "流式返回翻译结果",
    "params": [],
    "bodyExample": "",
    "documentation": "【3. 流式翻译（中英互译）】\n接口：POST /api/v1/translate/stream\n描述：流式返回翻译结果\n\n---"
  },
  {
    "id": "post-translate-text",
    "categoryId": "translate",
    "categoryName": "翻译",
    "order": 4,
    "name": "翻译",
    "method": "POST",
    "path": "/api/v1/translate/text",
    "description": "普通文本翻译",
    "params": [],
    "bodyExample": "",
    "documentation": "【4. 翻译】\n接口：POST /api/v1/translate/text\n描述：普通文本翻译"
  },
  {
    "id": "post-text-aes-encrypt",
    "categoryId": "crypto",
    "categoryName": "加密解密",
    "order": 1,
    "name": "AES 加密",
    "method": "POST",
    "path": "/api/v1/text/aes/encrypt",
    "description": "AES加密文本",
    "params": [],
    "bodyExample": "{\n  \"text\": \"待加密文本\",\n  \"key\": \"密钥（16/24/32字节）\"\n}",
    "documentation": "【1. AES 加密】\n接口：POST /api/v1/text/aes/encrypt\n描述：AES加密文本\n\n请求参数（JSON Body）：\n{\n  \"text\": \"待加密文本\",\n  \"key\": \"密钥（16/24/32字节）\"\n}\n\n---"
  },
  {
    "id": "post-text-aes-decrypt",
    "categoryId": "crypto",
    "categoryName": "加密解密",
    "order": 2,
    "name": "AES 解密",
    "method": "POST",
    "path": "/api/v1/text/aes/decrypt",
    "description": "AES解密文本",
    "params": [],
    "bodyExample": "",
    "documentation": "【2. AES 解密】\n接口：POST /api/v1/text/aes/decrypt\n描述：AES解密文本\n\n---"
  },
  {
    "id": "post-text-aes-encrypt-advanced",
    "categoryId": "crypto",
    "categoryName": "加密解密",
    "order": 3,
    "name": "AES高级加密",
    "method": "POST",
    "path": "/api/v1/text/aes/encrypt/advanced",
    "description": "AES高级加密（支持IV等参数）",
    "params": [],
    "bodyExample": "",
    "documentation": "【3. AES高级加密】\n接口：POST /api/v1/text/aes/encrypt/advanced\n描述：AES高级加密（支持IV等参数）\n\n---"
  },
  {
    "id": "post-text-aes-decrypt-advanced",
    "categoryId": "crypto",
    "categoryName": "加密解密",
    "order": 4,
    "name": "AES高级解密",
    "method": "POST",
    "path": "/api/v1/text/aes/decrypt/advanced",
    "description": "AES高级解密",
    "params": [],
    "bodyExample": "",
    "documentation": "【4. AES高级解密】\n接口：POST /api/v1/text/aes/decrypt/advanced\n描述：AES高级解密\n\n---"
  },
  {
    "id": "get-text-md5",
    "categoryId": "crypto",
    "categoryName": "加密解密",
    "order": 5,
    "name": "MD5 哈希",
    "method": "GET",
    "path": "/api/v1/text/md5",
    "description": "计算文本MD5哈希值",
    "params": [
      {
        "name": "text",
        "type": "string",
        "required": true,
        "description": "待计算文本"
      }
    ],
    "bodyExample": "",
    "documentation": "【5. MD5 哈希】\n接口：GET /api/v1/text/md5\n描述：计算文本MD5哈希值\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ text        │ string │ 是     │ 待计算文本                  │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n请求示例：\ncurl 'https://uapis.cn/api/v1/text/md5?text=hello'\n\n响应示例：\n{\n  \"code\": 200,\n  \"message\": \"success\",\n  \"data\": {\n    \"text\": \"hello\",\n    \"md5\": \"5d41402abc4b2a76b9719d911017c592\"\n  }\n}\n\n---"
  },
  {
    "id": "post-text-md5",
    "categoryId": "crypto",
    "categoryName": "加密解密",
    "order": 6,
    "name": "MD5 哈希 (POST)",
    "method": "POST",
    "path": "/api/v1/text/md5",
    "description": "POST方式计算MD5",
    "params": [],
    "bodyExample": "",
    "documentation": "【6. MD5 哈希 (POST)】\n接口：POST /api/v1/text/md5\n描述：POST方式计算MD5\n\n---"
  },
  {
    "id": "post-text-md5-verify",
    "categoryId": "crypto",
    "categoryName": "加密解密",
    "order": 7,
    "name": "MD5 校验",
    "method": "POST",
    "path": "/api/v1/text/md5/verify",
    "description": "校验文本与MD5是否匹配",
    "params": [],
    "bodyExample": "{\n  \"text\": \"原始文本\",\n  \"md5\": \"待校验的MD5值\"\n}",
    "documentation": "【7. MD5 校验】\n接口：POST /api/v1/text/md5/verify\n描述：校验文本与MD5是否匹配\n\n请求参数（JSON Body）：\n{\n  \"text\": \"原始文本\",\n  \"md5\": \"待校验的MD5值\"\n}\n\n---"
  },
  {
    "id": "post-text-base64-encode",
    "categoryId": "crypto",
    "categoryName": "加密解密",
    "order": 8,
    "name": "Base64 编码",
    "method": "POST",
    "path": "/api/v1/text/base64/encode",
    "description": "Base64编码",
    "params": [],
    "bodyExample": "",
    "documentation": "【8. Base64 编码】\n接口：POST /api/v1/text/base64/encode\n描述：Base64编码\n\n---"
  },
  {
    "id": "post-text-base64-decode",
    "categoryId": "crypto",
    "categoryName": "加密解密",
    "order": 9,
    "name": "Base64 解码",
    "method": "POST",
    "path": "/api/v1/text/base64/decode",
    "description": "Base64解码",
    "params": [],
    "bodyExample": "",
    "documentation": "【9. Base64 解码】\n接口：POST /api/v1/text/base64/decode\n描述：Base64解码"
  },
  {
    "id": "post-sensitive-word-analyze",
    "categoryId": "safety",
    "categoryName": "敏感词检测",
    "order": 1,
    "name": "分析敏感词",
    "method": "POST",
    "path": "/api/v1/sensitive/word/analyze",
    "description": "分析文本中的敏感词",
    "params": [],
    "bodyExample": "{\n  \"text\": \"待检测文本\"\n}",
    "documentation": "【1. 分析敏感词】\n接口：POST /api/v1/sensitive/word/analyze\n描述：分析文本中的敏感词\n\n请求参数（JSON Body）：\n{\n  \"text\": \"待检测文本\"\n}\n\n请求示例：\ncurl -X POST 'https://uapis.cn/api/v1/sensitive/word/analyze' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"text\":\"这是一段测试文本\"}'\n\n响应示例：\n{\n  \"code\": 200,\n  \"message\": \"success\",\n  \"data\": {\n    \"has_sensitive\": false,\n    \"words\": [],\n    \"count\": 0\n  }\n}\n\n---"
  },
  {
    "id": "post-image-nsfw",
    "categoryId": "safety",
    "categoryName": "敏感词检测",
    "order": 2,
    "name": "图片敏感检测",
    "method": "POST",
    "path": "/api/v1/image/nsfw",
    "description": "检测图片是否包含敏感内容",
    "params": [],
    "bodyExample": "",
    "documentation": "【2. 图片敏感检测】\n接口：POST /api/v1/image/nsfw\n描述：检测图片是否包含敏感内容\n\n---"
  },
  {
    "id": "get-sensitive-word-analyze-query",
    "categoryId": "safety",
    "categoryName": "敏感词检测",
    "order": 3,
    "name": "敏感词分析 (GET)",
    "method": "GET",
    "path": "/api/v1/sensitive/word/analyze/query",
    "description": "GET方式分析敏感词",
    "params": [],
    "bodyExample": "",
    "documentation": "【3. 敏感词分析 (GET)】\n接口：GET /api/v1/sensitive/word/analyze/query\n描述：GET方式分析敏感词\n\n---"
  },
  {
    "id": "post-sensitive-word-quick-check",
    "categoryId": "safety",
    "categoryName": "敏感词检测",
    "order": 4,
    "name": "敏感词检测（快速）",
    "method": "POST",
    "path": "/api/v1/sensitive/word/quick/check",
    "description": "快速敏感词检测",
    "params": [],
    "bodyExample": "",
    "documentation": "【4. 敏感词检测（快速）】\n接口：POST /api/v1/sensitive/word/quick/check\n描述：快速敏感词检测"
  },
  {
    "id": "get-webparse-metadata",
    "categoryId": "webparse",
    "categoryName": "网页解析",
    "order": 1,
    "name": "提取网页元数据",
    "method": "GET",
    "path": "/api/v1/webparse/metadata",
    "description": "提取网页标题、描述、关键词等",
    "params": [
      {
        "name": "url",
        "type": "string",
        "required": true,
        "description": "网页URL"
      }
    ],
    "bodyExample": "",
    "documentation": "【1. 提取网页元数据】\n接口：GET /api/v1/webparse/metadata\n描述：提取网页标题、描述、关键词等\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ url         │ string │ 是     │ 网页URL                     │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-webparse-extractimages",
    "categoryId": "webparse",
    "categoryName": "网页解析",
    "order": 2,
    "name": "提取网页图片",
    "method": "GET",
    "path": "/api/v1/webparse/extractimages",
    "description": "提取网页中的所有图片",
    "params": [],
    "bodyExample": "",
    "documentation": "【2. 提取网页图片】\n接口：GET /api/v1/webparse/extractimages\n描述：提取网页中的所有图片\n\n---"
  },
  {
    "id": "post-web-tomarkdown-async",
    "categoryId": "webparse",
    "categoryName": "网页解析",
    "order": 3,
    "name": "网页转 Markdown",
    "method": "POST",
    "path": "/api/v1/web/tomarkdown/async",
    "description": "将网页转换为Markdown格式（异步）",
    "params": [],
    "bodyExample": "{\n  \"url\": \"网页URL\"\n}",
    "documentation": "【3. 网页转 Markdown】\n接口：POST /api/v1/web/tomarkdown/async\n描述：将网页转换为Markdown格式（异步）\n\n请求参数（JSON Body）：\n{\n  \"url\": \"网页URL\"\n}\n\n---"
  },
  {
    "id": "get-web-tomarkdown-async-status",
    "categoryId": "webparse",
    "categoryName": "网页解析",
    "order": 4,
    "name": "转换任务状态",
    "method": "GET",
    "path": "/api/v1/web/tomarkdown/async/status",
    "description": "查询转换任务状态",
    "params": [],
    "bodyExample": "",
    "documentation": "【4. 转换任务状态】\n接口：GET /api/v1/web/tomarkdown/async/status\n描述：查询转换任务状态\n\n---"
  },
  {
    "id": "post-text-markdown-to-html",
    "categoryId": "webparse",
    "categoryName": "网页解析",
    "order": 5,
    "name": "Markdown 转 HTML",
    "method": "POST",
    "path": "/api/v1/text/markdown/to/html",
    "description": "将Markdown转换为HTML",
    "params": [],
    "bodyExample": "",
    "documentation": "【5. Markdown 转 HTML】\n接口：POST /api/v1/text/markdown/to/html\n描述：将Markdown转换为HTML\n\n---"
  },
  {
    "id": "post-text-markdown-to-pdf",
    "categoryId": "webparse",
    "categoryName": "网页解析",
    "order": 6,
    "name": "Markdown 转 PDF",
    "method": "POST",
    "path": "/api/v1/text/markdown/to/pdf",
    "description": "将Markdown转换为PDF",
    "params": [],
    "bodyExample": "",
    "documentation": "【6. Markdown 转 PDF】\n接口：POST /api/v1/text/markdown/to/pdf\n描述：将Markdown转换为PDF"
  },
  {
    "id": "get-misc-district",
    "categoryId": "misc",
    "categoryName": "杂项",
    "order": 1,
    "name": "Adcode 国内外行政区域查询",
    "method": "GET",
    "path": "/api/v1/misc/district",
    "description": "查询行政区划信息【热门】",
    "params": [
      {
        "name": "keywords",
        "type": "string",
        "required": false,
        "description": "关键词搜索"
      },
      {
        "name": "adcode",
        "type": "string",
        "required": false,
        "description": "行政区划代码"
      },
      {
        "name": "lat",
        "type": "number",
        "required": false,
        "description": "纬度"
      },
      {
        "name": "lng",
        "type": "number",
        "required": false,
        "description": "经度"
      },
      {
        "name": "level",
        "type": "string",
        "required": false,
        "description": "行政级别过滤"
      },
      {
        "name": "country",
        "type": "string",
        "required": false,
        "description": "国家代码过滤"
      },
      {
        "name": "limit",
        "type": "int",
        "required": false,
        "description": "返回数量，默认20，最大100"
      }
    ],
    "bodyExample": "",
    "documentation": "【1. Adcode 国内外行政区域查询】\n接口：GET /api/v1/misc/district\n描述：查询行政区划信息【热门】\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ keywords    │ string │ 否     │ 关键词搜索                  │\n│ adcode      │ string │ 否     │ 行政区划代码                │\n│ lat         │ number │ 否     │ 纬度                        │\n│ lng         │ number │ 否     │ 经度                        │\n│ level       │ string │ 否     │ 行政级别过滤                │\n│ country     │ string │ 否     │ 国家代码过滤                │\n│ limit       │ int    │ 否     │ 返回数量，默认20，最大100   │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n请求示例：\ncurl 'https://uapis.cn/api/v1/misc/district?keywords=北京'\n\n---"
  },
  {
    "id": "get-misc-phoneinfo",
    "categoryId": "misc",
    "categoryName": "杂项",
    "order": 2,
    "name": "查询手机归属地",
    "method": "GET",
    "path": "/api/v1/misc/phoneinfo",
    "description": "查询手机号归属地",
    "params": [
      {
        "name": "phone",
        "type": "string",
        "required": true,
        "description": "手机号码"
      }
    ],
    "bodyExample": "",
    "documentation": "【2. 查询手机归属地】\n接口：GET /api/v1/misc/phoneinfo\n描述：查询手机号归属地\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ phone       │ string │ 是     │ 手机号码                    │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-misc-hotboard",
    "categoryId": "misc",
    "categoryName": "杂项",
    "order": 3,
    "name": "查询热榜",
    "method": "GET",
    "path": "/api/v1/misc/hotboard",
    "description": "获取各平台热搜榜",
    "params": [
      {
        "name": "type",
        "type": "string",
        "required": true,
        "description": "热榜类型"
      }
    ],
    "bodyExample": "",
    "documentation": "【3. 查询热榜】\n接口：GET /api/v1/misc/hotboard\n描述：获取各平台热搜榜\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ type        │ string │ 是     │ 热榜类型                    │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n支持的热榜类型：\n- weibo: 微博热搜\n- zhihu: 知乎热榜\n- bilibili: B站热搜\n- douyin: 抖音热点\n- toutiao: 今日头条\n- baidu: 百度热搜\n\n---"
  },
  {
    "id": "get-saying",
    "categoryId": "misc",
    "categoryName": "杂项",
    "order": 4,
    "name": "一言",
    "method": "GET",
    "path": "/api/v1/saying",
    "description": "获取随机一句话",
    "params": [],
    "bodyExample": "",
    "documentation": "【4. 一言】\n接口：GET /api/v1/saying\n描述：获取随机一句话\n\n---"
  },
  {
    "id": "get-daily-news-image",
    "categoryId": "misc",
    "categoryName": "杂项",
    "order": 5,
    "name": "每日新闻图",
    "method": "GET",
    "path": "/api/v1/daily/news/image",
    "description": "获取每日新闻图片",
    "params": [],
    "bodyExample": "",
    "documentation": "【5. 每日新闻图】\n接口：GET /api/v1/daily/news/image\n描述：获取每日新闻图片\n\n---"
  },
  {
    "id": "get-history-programmer-today",
    "categoryId": "misc",
    "categoryName": "杂项",
    "order": 6,
    "name": "程序员历史上的今天",
    "method": "GET",
    "path": "/api/v1/history/programmer/today",
    "description": "获取程序员历史上的今天",
    "params": [],
    "bodyExample": "",
    "documentation": "【6. 程序员历史上的今天】\n接口：GET /api/v1/history/programmer/today\n描述：获取程序员历史上的今天\n\n---"
  },
  {
    "id": "get-history-programmer",
    "categoryId": "misc",
    "categoryName": "杂项",
    "order": 7,
    "name": "程序员历史事件",
    "method": "GET",
    "path": "/api/v1/history/programmer",
    "description": "查询程序员历史事件",
    "params": [],
    "bodyExample": "",
    "documentation": "【7. 程序员历史事件】\n接口：GET /api/v1/history/programmer\n描述：查询程序员历史事件\n\n---"
  },
  {
    "id": "post-convert-json",
    "categoryId": "misc",
    "categoryName": "杂项",
    "order": 8,
    "name": "JSON 格式化",
    "method": "POST",
    "path": "/api/v1/convert/json",
    "description": "格式化JSON数据",
    "params": [],
    "bodyExample": "",
    "documentation": "【8. JSON 格式化】\n接口：POST /api/v1/convert/json\n描述：格式化JSON数据\n\n---"
  },
  {
    "id": "get-avatar-gravatar",
    "categoryId": "misc",
    "categoryName": "杂项",
    "order": 9,
    "name": "获取Gravatar头像",
    "method": "GET",
    "path": "/api/v1/avatar/gravatar",
    "description": "获取Gravatar头像",
    "params": [
      {
        "name": "email",
        "type": "string",
        "required": true,
        "description": "邮箱地址"
      },
      {
        "name": "size",
        "type": "int",
        "required": false,
        "description": "尺寸，默认80"
      }
    ],
    "bodyExample": "",
    "documentation": "【9. 获取Gravatar头像】\n接口：GET /api/v1/avatar/gravatar\n描述：获取Gravatar头像\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ email       │ string │ 是     │ 邮箱地址                    │\n│ size        │ int    │ 否     │ 尺寸，默认80                │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-answerbook-ask",
    "categoryId": "misc",
    "categoryName": "杂项",
    "order": 10,
    "name": "答案之书",
    "method": "GET",
    "path": "/api/v1/answerbook/ask",
    "description": "获取随机答案",
    "params": [
      {
        "name": "question",
        "type": "string",
        "required": false,
        "description": "问题"
      }
    ],
    "bodyExample": "",
    "documentation": "【10. 答案之书】\n接口：GET /api/v1/answerbook/ask\n描述：获取随机答案\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ question    │ string │ 否     │ 问题                        │\n└─────────────┴────────┴────────┴─────────────────────────────┘"
  },
  {
    "id": "get-game-epic-free",
    "categoryId": "game",
    "categoryName": "游戏",
    "order": 1,
    "name": "Epic 免费游戏",
    "method": "GET",
    "path": "/api/v1/game/epic/free",
    "description": "获取Epic本周免费游戏",
    "params": [],
    "bodyExample": "",
    "documentation": "【1. Epic 免费游戏】\n接口：GET /api/v1/game/epic/free\n描述：获取Epic本周免费游戏\n\n---"
  },
  {
    "id": "get-game-steam-summary",
    "categoryId": "game",
    "categoryName": "游戏",
    "order": 2,
    "name": "查询 Steam 用户",
    "method": "GET",
    "path": "/api/v1/game/steam/summary",
    "description": "查询Steam用户信息",
    "params": [
      {
        "name": "steamid",
        "type": "string",
        "required": true,
        "description": "Steam ID"
      }
    ],
    "bodyExample": "",
    "documentation": "【2. 查询 Steam 用户】\n接口：GET /api/v1/game/steam/summary\n描述：查询Steam用户信息\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ steamid     │ string │ 是     │ Steam ID                    │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-game-minecraft-userinfo",
    "categoryId": "game",
    "categoryName": "游戏",
    "order": 3,
    "name": "查询 MC 玩家",
    "method": "GET",
    "path": "/api/v1/game/minecraft/userinfo",
    "description": "查询Minecraft玩家信息",
    "params": [
      {
        "name": "name",
        "type": "string",
        "required": true,
        "description": "玩家名称"
      }
    ],
    "bodyExample": "",
    "documentation": "【3. 查询 MC 玩家】\n接口：GET /api/v1/game/minecraft/userinfo\n描述：查询Minecraft玩家信息\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ name        │ string │ 是     │ 玩家名称                    │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-game-minecraft-serverstatus",
    "categoryId": "game",
    "categoryName": "游戏",
    "order": 4,
    "name": "查询 MC 服务器",
    "method": "GET",
    "path": "/api/v1/game/minecraft/serverstatus",
    "description": "查询MC服务器状态",
    "params": [
      {
        "name": "host",
        "type": "string",
        "required": true,
        "description": "服务器地址"
      },
      {
        "name": "port",
        "type": "int",
        "required": false,
        "description": "端口，默认25565"
      }
    ],
    "bodyExample": "",
    "documentation": "【4. 查询 MC 服务器】\n接口：GET /api/v1/game/minecraft/serverstatus\n描述：查询MC服务器状态\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ host        │ string │ 是     │ 服务器地址                  │\n│ port        │ int    │ 否     │ 端口，默认25565             │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-game-minecraft-historyid",
    "categoryId": "game",
    "categoryName": "游戏",
    "order": 5,
    "name": "查询 MC 曾用名",
    "method": "GET",
    "path": "/api/v1/game/minecraft/historyid",
    "description": "查询MC玩家曾用名",
    "params": [],
    "bodyExample": "",
    "documentation": "【5. 查询 MC 曾用名】\n接口：GET /api/v1/game/minecraft/historyid\n描述：查询MC玩家曾用名"
  },
  {
    "id": "get-github-repo",
    "categoryId": "github",
    "categoryName": "GitHub",
    "order": 1,
    "name": "查询 GitHub 仓库",
    "method": "GET",
    "path": "/api/v1/github/repo",
    "description": "查询GitHub仓库信息",
    "params": [
      {
        "name": "owner",
        "type": "string",
        "required": true,
        "description": "仓库所有者"
      },
      {
        "name": "repo",
        "type": "string",
        "required": true,
        "description": "仓库名称"
      }
    ],
    "bodyExample": "",
    "documentation": "【1. 查询 GitHub 仓库】\n接口：GET /api/v1/github/repo\n描述：查询GitHub仓库信息\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ owner       │ string │ 是     │ 仓库所有者                  │\n│ repo        │ string │ 是     │ 仓库名称                    │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n请求示例：\ncurl 'https://uapis.cn/api/v1/github/repo?owner=torvalds&repo=linux'\n\n---"
  },
  {
    "id": "get-github-user",
    "categoryId": "github",
    "categoryName": "GitHub",
    "order": 2,
    "name": "查询 GitHub 用户信息",
    "method": "GET",
    "path": "/api/v1/github/user",
    "description": "查询GitHub用户信息",
    "params": [
      {
        "name": "username",
        "type": "string",
        "required": true,
        "description": "用户名"
      }
    ],
    "bodyExample": "",
    "documentation": "【2. 查询 GitHub 用户信息】\n接口：GET /api/v1/github/user\n描述：查询GitHub用户信息\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ username    │ string │ 是     │ 用户名                      │\n└─────────────┴────────┴────────┴─────────────────────────────┘"
  },
  {
    "id": "get-random-image",
    "categoryId": "random",
    "categoryName": "随机生成",
    "order": 1,
    "name": "随机图片",
    "method": "GET",
    "path": "/api/v1/random/image",
    "description": "获取随机图片",
    "params": [],
    "bodyExample": "",
    "documentation": "【1. 随机图片】\n接口：GET /api/v1/random/image\n描述：获取随机图片\n\n---"
  },
  {
    "id": "get-random-string",
    "categoryId": "random",
    "categoryName": "随机生成",
    "order": 2,
    "name": "随机字符串",
    "method": "GET",
    "path": "/api/v1/random/string",
    "description": "生成随机字符串",
    "params": [
      {
        "name": "length",
        "type": "int",
        "required": false,
        "description": "长度，默认16"
      },
      {
        "name": "type",
        "type": "string",
        "required": false,
        "description": "类型：all/number/letter"
      }
    ],
    "bodyExample": "",
    "documentation": "【2. 随机字符串】\n接口：GET /api/v1/random/string\n描述：生成随机字符串\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ length      │ int    │ 否     │ 长度，默认16                │\n│ type        │ string │ 否     │ 类型：all/number/letter     │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-misc-randomnumber",
    "categoryId": "random",
    "categoryName": "随机生成",
    "order": 3,
    "name": "随机数生成",
    "method": "GET",
    "path": "/api/v1/misc/randomnumber",
    "description": "生成随机数",
    "params": [
      {
        "name": "min",
        "type": "int",
        "required": false,
        "description": "最小值，默认0"
      },
      {
        "name": "max",
        "type": "int",
        "required": false,
        "description": "最大值，默认100"
      },
      {
        "name": "count",
        "type": "int",
        "required": false,
        "description": "数量，默认1"
      }
    ],
    "bodyExample": "",
    "documentation": "【3. 随机数生成】\n接口：GET /api/v1/misc/randomnumber\n描述：生成随机数\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ min         │ int    │ 否     │ 最小值，默认0               │\n│ max         │ int    │ 否     │ 最大值，默认100             │\n│ count       │ int    │ 否     │ 数量，默认1                 │\n└─────────────┴────────┴────────┴─────────────────────────────┘"
  },
  {
    "id": "post-search-aggregate",
    "categoryId": "search",
    "categoryName": "搜索",
    "order": 1,
    "name": "智能搜索",
    "method": "POST",
    "path": "/api/v1/search/aggregate",
    "description": "聚合搜索多个引擎",
    "params": [],
    "bodyExample": "{\n  \"query\": \"搜索关键词\",\n  \"engines\": [\"baidu\", \"bing\", \"google\"]\n}",
    "documentation": "【1. 智能搜索】\n接口：POST /api/v1/search/aggregate\n描述：聚合搜索多个引擎\n\n请求参数（JSON Body）：\n{\n  \"query\": \"搜索关键词\",\n  \"engines\": [\"baidu\", \"bing\", \"google\"]\n}\n\n---"
  },
  {
    "id": "get-search-engines",
    "categoryId": "search",
    "categoryName": "搜索",
    "order": 2,
    "name": "搜索引擎配置",
    "method": "GET",
    "path": "/api/v1/search/engines",
    "description": "获取支持的搜索引擎列表",
    "params": [],
    "bodyExample": "",
    "documentation": "【2. 搜索引擎配置】\n接口：GET /api/v1/search/engines\n描述：获取支持的搜索引擎列表"
  },
  {
    "id": "get-status-usage",
    "categoryId": "status",
    "categoryName": "状态",
    "order": 1,
    "name": "获取API端点使用统计",
    "method": "GET",
    "path": "/api/v1/status/usage",
    "description": "获取API使用统计",
    "params": [],
    "bodyExample": "",
    "documentation": "【1. 获取API端点使用统计】\n接口：GET /api/v1/status/usage\n描述：获取API使用统计\n\n---"
  },
  {
    "id": "get-status-ratelimit",
    "categoryId": "status",
    "categoryName": "状态",
    "order": 2,
    "name": "限流状态",
    "method": "GET",
    "path": "/api/v1/status/ratelimit",
    "description": "获取当前限流状态",
    "params": [],
    "bodyExample": "",
    "documentation": "【2. 限流状态】\n接口：GET /api/v1/status/ratelimit\n描述：获取当前限流状态"
  },
  {
    "id": "post-clipzy-store",
    "categoryId": "clipzy",
    "categoryName": "在线剪贴板",
    "order": 1,
    "name": "步骤1：上传加密数据",
    "method": "POST",
    "path": "/api/v1/clipzy/store",
    "description": "上传加密数据到剪贴板",
    "params": [],
    "bodyExample": "{\n  \"text\": \"要存储的文本\",\n  \"password\": \"密码（可选）\",\n  \"expire\": \"过期时间（秒）\"\n}",
    "documentation": "【1. 步骤1：上传加密数据】\n接口：POST /api/v1/clipzy/store\n描述：上传加密数据到剪贴板\n\n请求参数（JSON Body）：\n{\n  \"text\": \"要存储的文本\",\n  \"password\": \"密码（可选）\",\n  \"expire\": \"过期时间（秒）\"\n}\n\n---"
  },
  {
    "id": "get-clipzy-get",
    "categoryId": "clipzy",
    "categoryName": "在线剪贴板",
    "order": 2,
    "name": "步骤2 (方法一): 获取加密数据",
    "method": "GET",
    "path": "/api/v1/clipzy/get",
    "description": "获取加密数据",
    "params": [
      {
        "name": "id",
        "type": "string",
        "required": true,
        "description": "剪贴板ID"
      },
      {
        "name": "password",
        "type": "string",
        "required": false,
        "description": "密码"
      }
    ],
    "bodyExample": "",
    "documentation": "【2. 步骤2 (方法一): 获取加密数据】\n接口：GET /api/v1/clipzy/get\n描述：获取加密数据\n\n请求参数：\n┌─────────────┬────────┬────────┬─────────────────────────────┐\n│ 参数名      │ 类型   │ 必填   │ 说明                        │\n├─────────────┼────────┼────────┼─────────────────────────────┤\n│ id          │ string │ 是     │ 剪贴板ID                    │\n│ password    │ string │ 否     │ 密码                        │\n└─────────────┴────────┴────────┴─────────────────────────────┘\n\n---"
  },
  {
    "id": "get-clipzy-raw",
    "categoryId": "clipzy",
    "categoryName": "在线剪贴板",
    "order": 3,
    "name": "步骤2 (方法二): 获取原始文本",
    "method": "GET",
    "path": "/api/v1/clipzy/raw",
    "description": "直接获取原始文本",
    "params": [],
    "bodyExample": "",
    "documentation": "【3. 步骤2 (方法二): 获取原始文本】\n接口：GET /api/v1/clipzy/raw\n描述：直接获取原始文本"
  },
  {
    "id": "post-image-speechless",
    "categoryId": "meme",
    "categoryName": "表情包",
    "order": 1,
    "name": "生成你们怎么不说话了表情包",
    "method": "POST",
    "path": "/api/v1/image/speechless",
    "description": "生成表情包",
    "params": [],
    "bodyExample": "",
    "documentation": "【1. 生成你们怎么不说话了表情包】\n接口：POST /api/v1/image/speechless\n描述：生成表情包\n\n---"
  },
  {
    "id": "post-image-motou",
    "categoryId": "meme",
    "categoryName": "表情包",
    "order": 2,
    "name": "生成摸摸头GIF",
    "method": "POST",
    "path": "/api/v1/image/motou",
    "description": "生成摸摸头GIF动图",
    "params": [],
    "bodyExample": "",
    "documentation": "【2. 生成摸摸头GIF】\n接口：POST /api/v1/image/motou\n描述：生成摸摸头GIF动图"
  }
]
