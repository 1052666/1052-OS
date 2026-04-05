"""
Context Builder - 上下文快照管理
"""

import json
import platform as platform_module
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Optional

from core.config import DATA_DIR, read_system_prompt, read_preferences


class ContextSnapshot:
    """上下文快照"""

    def __init__(
        self,
        timestamp: str,
        system_prompt: str,
        env_info: dict,
        user_info: dict,
        preferences: str,
        skills_summary: str = "",
    ):
        self.timestamp = timestamp
        self.system_prompt = system_prompt
        self.env_info = env_info
        self.user_info = user_info
        self.preferences = preferences
        self.skills_summary = skills_summary

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "system_prompt": self.system_prompt,
            "env_info": self.env_info,
            "user_info": self.user_info,
            "preferences": self.preferences,
            "skills_summary": self.skills_summary,
        }


class ContextBuilder:
    """
    上下文构建器 - 负责生成并缓存上下文快照

    参考 D:\claudecli\claude-code-main\src\context.ts
    """

    def __init__(self):
        self._cache: Optional[ContextSnapshot] = None
        self._cache_valid = False

    def invalidate_cache(self):
        """使缓存失效（在 clear、compress、cwd/config 变化后调用）"""
        self._cache_valid = False
        self._cache = None

    def build_context_snapshot(
        self,
        platform: str = "web",
        user_id: str = "",
        include_git: bool = True,
        include_readme: bool = True,
        include_dir_structure: bool = False,
        force_refresh: bool = False,
    ) -> ContextSnapshot:
        """
        构建当前上下文快照

        Args:
            platform: 当前平台
            user_id: 当前用户 ID
            include_git: 是否包含 git 状态
            include_readme: 是否包含 README 摘要
            include_dir_structure: 是否包含目录结构
            force_refresh: 强制刷新缓存

        Returns:
            ContextSnapshot 实例
        """
        if self._cache_valid and self._cache and not force_refresh:
            return self._cache

        timestamp = datetime.now().isoformat()

        # 环境信息
        env_info = self._get_env_info()

        # 用户信息
        user_info = {"platform": platform, "user_id": user_id}

        # 系统提示词
        system_prompt = read_system_prompt()

        # 用户偏好
        preferences = read_preferences()

        # Skills summary（由外部注入，这里留空）
        skills_summary = ""

        # Git 状态（可选）
        if include_git:
            git_info = self._get_git_status()
            if git_info:
                env_info["git"] = git_info

        # README 摘要（可选）
        if include_readme:
            readme_content = self._get_readme()
            if readme_content:
                env_info["readme"] = readme_content[:1000]  # 限制长度

        # 目录结构（可选，开销较大）
        if include_dir_structure:
            dir_structure = self._get_directory_structure()
            if dir_structure:
                env_info["directory_structure"] = dir_structure

        snapshot = ContextSnapshot(
            timestamp=timestamp,
            system_prompt=system_prompt,
            env_info=env_info,
            user_info=user_info,
            preferences=preferences,
            skills_summary=skills_summary,
        )

        self._cache = snapshot
        self._cache_valid = True

        return snapshot

    def _get_env_info(self) -> dict:
        """获取环境信息"""
        system = platform_module.system()
        return {
            "system": system,
            "platform": platform_module.platform(),
            "python_version": platform_module.python_version(),
            "cwd": str(Path.cwd()),
        }

    def _get_git_status(self) -> Optional[str]:
        """获取 git 状态"""
        import subprocess

        try:
            result = subprocess.run(
                ["git", "status", "--short"],
                capture_output=True,
                text=True,
                timeout=1,
                cwd=Path.cwd(),
            )
            if result.returncode == 0:
                status_lines = result.stdout.strip()
                if status_lines:
                    return f"有未提交的更改:\n{status_lines[:500]}"
                return "工作目录干净"
        except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
            pass
        return None

    def _get_readme(self) -> Optional[str]:
        """获取 README 摘要"""
        readme_path = Path.cwd() / "README.md"
        if not readme_path.exists():
            readme_path = Path.cwd() / "README"
            if not readme_path.exists():
                return None

        try:
            content = readme_path.read_text(encoding="utf-8")
            # 只返回前 1000 字符作为摘要
            return content[:1000]
        except Exception:
            return None

    def _get_directory_structure(self) -> Optional[str]:
        """获取目录结构（简化版，避免大目录）"""
        import subprocess

        try:
            result = subprocess.run(
                ["ls", "-F"] if platform_module.system() != "Windows" else ["dir", "/B"],
                capture_output=True,
                text=True,
                timeout=1,
                cwd=Path.cwd(),
            )
            if result.returncode == 0:
                return result.stdout.strip()[:1000]
        except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
            pass
        return None

    def get_context_debug_info(self) -> dict:
        """
        获取上下文调试信息（用于 /api/chat/context-debug）

        返回各 section 的体积占比，便于调试
        """
        snapshot = self.build_context_snapshot()

        return {
            "timestamp": snapshot.timestamp,
            "sections": {
                "system_prompt": {
                    "length": len(snapshot.system_prompt),
                    "preview": snapshot.system_prompt[:200] + "..." if len(snapshot.system_prompt) > 200 else snapshot.system_prompt,
                },
                "preferences": {
                    "length": len(snapshot.preferences),
                    "preview": snapshot.preferences[:200] + "..." if len(snapshot.preferences) > 200 else snapshot.preferences,
                },
                "env_info": snapshot.env_info,
                "user_info": snapshot.user_info,
                "skills_summary": {
                    "length": len(snapshot.skills_summary),
                    "preview": snapshot.skills_summary[:200] + "..." if len(snapshot.skills_summary) > 200 else snapshot.skills_summary,
                },
            },
            "total_characters": len(snapshot.system_prompt) + len(snapshot.preferences) + len(snapshot.skills_summary),
        }


# 全局单例
_context_builder = ContextBuilder()


def get_context_builder() -> ContextBuilder:
    return _context_builder


def build_context_snapshot(
    platform: str = "web",
    user_id: str = "",
    force_refresh: bool = False,
) -> ContextSnapshot:
    """便捷函数：构建上下文快照"""
    return _context_builder.build_context_snapshot(
        platform=platform,
        user_id=user_id,
        force_refresh=force_refresh,
    )


def invalidate_context_cache():
    """便捷函数：使上下文缓存失效"""
    _context_builder.invalidate_cache()
