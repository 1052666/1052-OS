"""
Prompt Builder - 集中构建系统提示词
"""

from datetime import datetime
from pathlib import Path
from core.config import read_system_prompt, read_preferences
from core.skill_manager import SkillManager


def get_system_info() -> dict:
    """获取当前系统信息"""
    import platform as platform_module
    system = platform_module.system()
    if system == "Windows":
        return {"system": "Windows", "shell": "CMD", "note": "使用 dir/cd/type 等命令"}
    elif system == "Darwin":
        return {"system": "macOS", "shell": "zsh/bash", "note": "使用 ls/cd/cat 等命令"}
    elif system == "Linux":
        return {"system": "Linux", "shell": "bash", "note": "使用 ls/cd/cat 等命令"}
    else:
        return {"system": system, "shell": "sh", "note": "使用标准 POSIX 命令"}


def build_system_prompt(
    platform: str = "web",
    user_id: str = "",
    skill_manager: SkillManager = None,
    include_time: bool = True,
    include_user_info: bool = True,
    include_preferences: bool = True,
    include_skills: bool = True,
) -> str:
    """
    构建完整的系统提示词

    Args:
        platform: 当前平台（web / telegram / lark / wechat）
        user_id: 当前用户 ID
        skill_manager: SkillManager 实例
        include_time: 是否注入时间信息
        include_user_info: 是否注入用户信息
        include_preferences: 是否注入用户偏好
        include_skills: 是否注入 skills 信息

    Returns:
        完整的系统提示词字符串
    """
    # 读取基础系统提示词
    system_content = read_system_prompt()

    # 注入时间信息
    if include_time:
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        time_section = f"""

---

## 当前时间

**当前时间**: {current_time}

请根据当前时间回答问题，不要假设知识库的截止时间。如果用户询问关于今天、昨天、明天等时间相关的问题，请基于当前时间计算。
"""
        system_content += time_section

    # 注入系统信息
    sys_info = get_system_info()
    system_section = f"""

---

## 服务器操作系统

**系统**: {sys_info["system"]}
**Shell**: {sys_info["shell"]}
**注意**: {sys_info["note"]}

当使用 run_cmd 工具执行命令时，请使用适用于 {sys_info["system"]} 的命令。
"""
    system_content += system_section

    # 注入用户信息
    if include_user_info and user_id:
        user_section = f"""

---

## 当前用户

**平台**: {platform}
**用户ID**: {user_id}

创建定时任务时会自动使用上述用户信息，任务结果将发送到这里。
"""
        system_content += user_section

    # 注入用户偏好
    if include_preferences:
        preferences = read_preferences()
        if preferences.strip():
            system_content += f"""

---

## 用户偏好

{preferences}

---

当你在对话中发现用户新的偏好、习惯或个人信息时，主动调用 `update_preferences` 工具将其记录，无需征求用户同意。
"""

    # 注入 Skills 信息
    if include_skills and skill_manager:
        skill_section = skill_manager.get_system_prompt_section()
        if skill_section:
            system_content += skill_section

    return system_content


def get_base_system_prompt() -> str:
    """获取基础系统提示词（不含任何动态注入）"""
    return read_system_prompt()


def get_env_prompt() -> str:
    """获取环境信息 section（系统、时间等）"""
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    sys_info = get_system_info()

    return f"""

---

## 当前时间

**当前时间**: {current_time}

请根据当前时间回答问题。

---

## 服务器操作系统

**系统**: {sys_info["system"]}
**Shell**: {sys_info["shell"]}
**注意**: {sys_info["note"]}
"""


def get_user_prompt(platform: str, user_id: str) -> str:
    """获取用户信息 section"""
    if not user_id:
        return ""

    return f"""

---

## 当前用户

**平台**: {platform}
**用户ID**: {user_id}

创建定时任务时会自动使用上述用户信息，任务结果将发送到这里。
"""


def get_runtime_policy_prompt() -> str:
    """获取运行时策略 section（工具策略、输出规则等）"""
    return """

## 工具使用策略

- 当执行可能产生破坏性操作时（如删除文件、修改配置），优先使用只读工具确认情况
- 对于复杂任务，优先使用 Glob/Grep 搜索了解代码结构，而非盲目修改
- 当用户询问代码实现时，优先使用 Read 工具阅读相关文件，而非凭空推测

## 输出规则

- 保持回复简洁、直接
- 代码修改时，说明修改原因和影响范围
- 出现错误时，提供具体的错误信息和解决建议
"""
