import json
import os
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

# 加载 .env 文件
load_dotenv()


def validate_config(config: dict) -> tuple[bool, Optional[str]]:
    """验证配置是否有效"""
    # 检查必需的 API Key
    if not config.get("api_key"):
        return False, "缺少 API Key 配置"

    # 验证温度参数范围
    temp = config.get("temperature", 0.7)
    if not (0 <= temp <= 2):
        return False, "temperature 必须在 0-2 之间"

    return True, None

# ─── Paths ────────────────────────────────────────────────────────
_ROOT = Path(__file__).parent.parent
DATA_DIR = _ROOT / "data"

SYSTEM_PROMPT_FILE   = DATA_DIR / "system_prompt.md"
MCP_CONFIG_FILE      = DATA_DIR / "mcp_servers.json"
CONVERSATION_FILE    = DATA_DIR / "conversation.json"
CONFIG_FILE          = DATA_DIR / "config.json"
PREFERENCES_FILE     = DATA_DIR / "preferences.md"


# ─── Helpers ──────────────────────────────────────────────────────
def read_system_prompt() -> str:
    if SYSTEM_PROMPT_FILE.exists():
        return SYSTEM_PROMPT_FILE.read_text(encoding="utf-8")
    return "You are a helpful assistant."


def load_conversation(platform: str = None, user_id: str = None) -> list:
    """
    加载对话历史

    Args:
        platform: 可选，筛选指定平台（如 "web", "telegram"）
        user_id: 可选，筛选指定用户

    Returns:
        筛选后的对话历史列表
    """
    if CONVERSATION_FILE.exists():
        try:
            all_messages = json.loads(CONVERSATION_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
    else:
        all_messages = []

    # 如果没有筛选条件，返回全部
    if platform is None and user_id is None:
        return all_messages

    # 按条件筛选
    filtered = []
    for msg in all_messages:
        meta = msg.get("_meta", {})
        if platform and meta.get("platform") != platform:
            continue
        if user_id and meta.get("user_id") != user_id:
            continue
        filtered.append(msg)

    return filtered


def save_conversation(messages: list, platform: str = "web", user_id: str = None):
    """
    保存对话历史，自动合并到统一文件

    Args:
        messages: 完整对话历史列表（或仅新增的 assistant 消息）
        platform: 来源平台（如 "web", "telegram"）
        user_id: 用户标识
    """
    DATA_DIR.mkdir(exist_ok=True)

    # 加载现有对话
    existing = []
    if CONVERSATION_FILE.exists():
        try:
            existing = json.loads(CONVERSATION_FILE.read_text(encoding="utf-8"))
        except Exception:
            existing = []

    # 构建消息索引，用于去重
    seen = {}
    for i, msg in enumerate(existing):
        key = f"{msg.get('role', '')}:{msg.get('content', '')[:50]}"
        seen[key] = i

    # 合并新消息
    for msg in messages:
        if not msg.get("content"):
            continue
        # 添加元数据
        if "_meta" not in msg:
            msg["_meta"] = {}
        msg["_meta"]["platform"] = platform
        if user_id:
            msg["_meta"]["user_id"] = user_id

        # 检查是否已存在（避免重复）
        key = f"{msg.get('role', '')}:{msg.get('content', '')[:50]}"
        if key not in seen:
            existing.append(msg)
            seen[key] = len(existing) - 1

    # 保留最近 200 条消息
    existing = existing[-200:]

    CONVERSATION_FILE.write_text(
        json.dumps(existing, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def read_preferences() -> str:
    if PREFERENCES_FILE.exists():
        return PREFERENCES_FILE.read_text(encoding="utf-8")
    return ""


def load_config() -> dict:
    """加载配置，优先使用环境变量，其次使用 config.json"""
    # 从文件加载基础配置
    config = {}
    if CONFIG_FILE.exists():
        try:
            config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass

    # 环境变量覆盖（优先级更高）
    if os.getenv("OPENAI_API_KEY"):
        config["api_key"] = os.getenv("OPENAI_API_KEY")
    if os.getenv("OPENAI_BASE_URL"):
        config["base_url"] = os.getenv("OPENAI_BASE_URL")
    if os.getenv("MODEL"):
        config["model"] = os.getenv("MODEL")
    if os.getenv("TEMPERATURE"):
        config["temperature"] = float(os.getenv("TEMPERATURE"))

    # IM 配置
    if "im" not in config:
        config["im"] = {}

    # Telegram
    if "telegram" not in config["im"]:
        config["im"]["telegram"] = {}
    if os.getenv("TELEGRAM_ENABLED"):
        config["im"]["telegram"]["enabled"] = os.getenv("TELEGRAM_ENABLED").lower() == "true"
    if os.getenv("TELEGRAM_BOT_TOKEN"):
        config["im"]["telegram"]["token"] = os.getenv("TELEGRAM_BOT_TOKEN")

    # 飞书
    if "lark" not in config["im"]:
        config["im"]["lark"] = {}
    if os.getenv("LARK_ENABLED"):
        config["im"]["lark"]["enabled"] = os.getenv("LARK_ENABLED").lower() == "true"
    if os.getenv("LARK_APP_ID"):
        config["im"]["lark"]["app_id"] = os.getenv("LARK_APP_ID")
    if os.getenv("LARK_APP_SECRET"):
        config["im"]["lark"]["app_secret"] = os.getenv("LARK_APP_SECRET")

    # 微信
    if "wechat" not in config["im"]:
        config["im"]["wechat"] = {}
    if os.getenv("WECHAT_ENABLED"):
        config["im"]["wechat"]["enabled"] = os.getenv("WECHAT_ENABLED").lower() == "true"
    if os.getenv("WECHAT_PRIMARY_CHAT"):
        config["im"]["wechat"]["primary_chat"] = os.getenv("WECHAT_PRIMARY_CHAT")
    if os.getenv("WECHAT_BOT_NAME"):
        config["im"]["wechat"]["bot_name"] = os.getenv("WECHAT_BOT_NAME")
    if os.getenv("WECHAT_MENTION_PATTERN"):
        config["im"]["wechat"]["mention_pattern"] = os.getenv("WECHAT_MENTION_PATTERN")

    return config


def save_config(data: dict):
    DATA_DIR.mkdir(exist_ok=True)
    CONFIG_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
