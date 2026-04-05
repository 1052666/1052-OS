# 贡献指南

感谢您对 1052 AI 助手项目的关注！

## 开发环境设置

### 1. 克隆项目

```bash
git clone <repository-url>
cd 1052
```

### 2. 安装依赖

```bash
# 安装生产依赖
pip install -r requirements.txt

# 安装开发依赖
pip install -r requirements-dev.txt
```

### 3. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，填入必要的配置
```

### 4. 启动开发服务器

```bash
python server.py
```

## 代码规范

### 代码格式化

使用 Black 进行代码格式化：

```bash
black .
```

### 代码检查

使用 Flake8 进行代码检查：

```bash
flake8 .
```

### 类型检查

使用 Mypy 进行类型检查：

```bash
mypy .
```

### Import 排序

使用 isort 排序 import 语句：

```bash
isort .
```

## 测试

运行测试：

```bash
pytest
```

运行测试并生成覆盖率报告：

```bash
pytest --cov=. --cov-report=html
```

## 提交规范

### Commit 消息格式

```
<type>: <subject>

<body>
```

类型（type）：
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式调整
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具相关

### 示例

```
feat: 添加 API 认证功能

- 实现 API Key 认证
- 添加认证中间件
- 更新文档
```

## Pull Request 流程

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 项目结构

```
1052/
├── core/           # 核心模块
├── routers/        # API 路由
├── mcp_client/     # MCP 客户端
├── im_integration/ # IM 平台集成
├── skills/         # 技能插件
├── static/         # 前端静态文件
├── wx/             # 微信自动化
└── data/           # 数据目录
```

## 添加新功能

### 添加新的 API 路由

1. 在 `routers/` 目录创建新文件
2. 定义路由和处理函数
3. 在 `server.py` 中注册路由

### 添加新的技能插件

1. 在 `skills/` 目录创建 Python 文件
2. 实现技能逻辑
3. 系统会自动热加载

## 问题反馈

如果遇到问题，请：

1. 检查是否已有相关 Issue
2. 提供详细的错误信息和复现步骤
3. 说明您的环境（操作系统、Python 版本等）

## 许可证

本项目采用 MIT 许可证。
