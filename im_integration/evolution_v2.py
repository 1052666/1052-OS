"""
进化模式 v2 - 任务规划与执行分离

工作流程：
1. 用户开启进化模式
2. AI 列举本轮要做的任务（规划阶段）
3. 逐个执行任务（执行阶段）
4. 完成所有任务后询问是否继续
5. 如果继续，回到步骤 2
6. 如果停止或任务完成，发送总结并停止
"""

import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, Callable, List, Dict

EVOLUTION_HISTORY_FILE = Path("data/evolution_logs/evolution_history.json")

class EvolutionState:
    """进化状态"""
    IDLE = "idle"           # 空闲
    PLANNING = "planning"   # 规划任务
    EXECUTING = "executing" # 执行任务
    WAITING = "waiting"     # 等待用户确认是否继续

class EvolutionManagerV2:
    """进化管理器 v2"""

    def __init__(self):
        self._active = False
        self._state = EvolutionState.IDLE
        self._cycle = 0
        self._tasks: List[Dict] = []  # 当前任务列表
        self._current_task_index = 0
        self._chat_handler: Optional[Callable] = None
        self._app_state = None
        self._platform = "web"
        self._user_id = ""

    def set_app_state(self, app_state):
        self._app_state = app_state

    def set_chat_handler(self, handler: Callable):
        self._chat_handler = handler

    @property
    def active(self) -> bool:
        return self._active

    def get_status(self) -> dict:
        return {
            "active": self._active,
            "state": self._state,
            "cycle": self._cycle,
            "tasks": self._tasks,
            "current_task": self._current_task_index,
        }

    def set_user(self, platform: str, user_id: str):
        """设置当前用户（兼容旧接口）"""
        self._platform = platform
        self._user_id = user_id

    async def trigger(self) -> str:
        """手动触发进化（兼容旧接口，等价于 start）"""
        if not self._active:
            return await self.start(self._platform, self._user_id)

        # 已在运行 → 如果处于等待状态则继续下一轮
        if self._state == EvolutionState.WAITING:
            return await self.continue_evolution()

        return "进化模式正在执行中，请等待当前任务完成"

    async def start(self, platform: str = "web", user_id: str = "") -> str:
        """开启进化模式"""
        if self._active:
            return "进化模式已经在运行中"

        self._active = True
        self._state = EvolutionState.PLANNING
        self._cycle = 1
        self._platform = platform
        self._user_id = user_id
        self._tasks = []
        self._current_task_index = 0

        # 开始规划任务
        await self._plan_tasks()

        return "进化模式已开启，正在规划任务..."

    async def stop(self) -> str:
        """停止进化模式"""
        if not self._active:
            return "进化模式未开启"

        self._active = False
        self._state = EvolutionState.IDLE

        # 保存总结
        await self._save_summary()

        return "进化模式已停止"

    async def continue_evolution(self) -> str:
        """继续下一轮进化"""
        if not self._active:
            return "进化模式未开启"

        self._cycle += 1
        self._state = EvolutionState.PLANNING
        self._tasks = []
        self._current_task_index = 0

        await self._plan_tasks()

        return f"开始第 {self._cycle} 轮进化，正在规划任务..."

    async def _plan_tasks(self):
        """规划任务阶段"""
        if not self._chat_handler:
            return

        # 构建规划提示
        planning_prompt = f"""【系统】进化模式 - 任务规划阶段（第 {self._cycle} 轮）

请列举本轮进化要完成的 3-5 个具体任务。每个任务应该：
- 对用户有实际价值
- 可以通过工具完成
- 明确具体，可衡量

请按以下格式输出：

## 本轮进化任务清单

1. [任务名称] - 简短描述
2. [任务名称] - 简短描述
3. [任务名称] - 简短描述

输出完任务清单后，我会逐个执行这些任务。"""

        messages = [{"role": "user", "content": planning_prompt}]
        full_response = ""

        try:
            async for chunk in self._chat_handler(messages):
                if chunk.get("type") == "delta":
                    full_response += chunk.get("content", "")
                elif chunk.get("type") == "done":
                    break

            # 解析任务列表
            self._tasks = self._parse_tasks(full_response)

            if self._tasks:
                self._state = EvolutionState.EXECUTING
                self._current_task_index = 0
                # 开始执行第一个任务
                await self._execute_next_task()
            else:
                await self._send_message("未能解析出任务列表，进化模式停止")
                self._active = False

        except Exception as e:
            await self._send_message(f"规划任务失败: {e}")
            self._active = False

    def _parse_tasks(self, response: str) -> List[Dict]:
        """从 AI 响应中解析任务列表"""
        tasks = []
        lines = response.split("\n")

        for line in lines:
            line = line.strip()
            # 匹配格式：1. [任务名] - 描述
            if line and (line[0].isdigit() or line.startswith("-")):
                # 简单解析
                task_text = line.lstrip("0123456789.-) ").strip()
                if task_text:
                    tasks.append({
                        "name": task_text[:50],  # 取前50个字符作为任务名
                        "description": task_text,
                        "status": "pending"
                    })

        return tasks[:5]  # 最多5个任务

    async def _execute_next_task(self):
        """执行下一个任务"""
        if self._current_task_index >= len(self._tasks):
            # 所有任务完成
            await self._all_tasks_completed()
            return

        task = self._tasks[self._current_task_index]
        task["status"] = "executing"

        # 构建执行提示
        execute_prompt = f"""【系统】进化模式 - 执行任务（第 {self._cycle} 轮，任务 {self._current_task_index + 1}/{len(self._tasks)}）

当前任务：{task['description']}

请使用工具完成这个任务。完成后输出：

## 任务完成
**任务**：{task['name']}
**结果**：具体成果
**问题**：遇到的困难（如果有）

如果任务无法完成，请说明原因并输出 `[TASK_FAILED]`。"""

        messages = [{"role": "user", "content": execute_prompt}]
        full_response = ""

        try:
            async for chunk in self._chat_handler(messages):
                if not self._active:
                    break

                if chunk.get("type") == "delta":
                    full_response += chunk.get("content", "")
                elif chunk.get("type") == "done":
                    break

            # 检查任务是否失败
            if "[TASK_FAILED]" in full_response:
                task["status"] = "failed"
            else:
                task["status"] = "completed"

            # 继续下一个任务
            self._current_task_index += 1
            await self._execute_next_task()

        except Exception as e:
            task["status"] = "error"
            await self._send_message(f"执行任务失败: {e}")
            self._current_task_index += 1
            await self._execute_next_task()

    async def _all_tasks_completed(self):
        """所有任务完成"""
        self._state = EvolutionState.WAITING

        completed = sum(1 for t in self._tasks if t["status"] == "completed")
        total = len(self._tasks)

        summary = f"""## 第 {self._cycle} 轮进化完成

完成任务：{completed}/{total}

"""
        for i, task in enumerate(self._tasks, 1):
            status_icon = "✅" if task["status"] == "completed" else "❌"
            summary += f"{i}. {status_icon} {task['name']}\n"

        summary += "\n是否继续下一轮进化？回复「继续」或「停止」"

        await self._send_message(summary)

    async def _send_message(self, content: str):
        """发送消息给用户"""
        if self._app_state and hasattr(self._app_state, 'im_manager'):
            im_manager = self._app_state.im_manager
            if self._platform == "telegram" and im_manager.telegram:
                await im_manager.telegram.send_message(self._user_id, content)
            elif self._platform == "wechat" and im_manager.wechat:
                await im_manager.wechat.send_message(self._user_id, content)

    async def _save_summary(self):
        """保存进化总结"""
        EVOLUTION_HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)

        record = {
            "timestamp": datetime.now().isoformat(),
            "cycle": self._cycle,
            "tasks": self._tasks,
            "completed": sum(1 for t in self._tasks if t["status"] == "completed"),
            "total": len(self._tasks)
        }

        history = []
        if EVOLUTION_HISTORY_FILE.exists():
            try:
                data = json.loads(EVOLUTION_HISTORY_FILE.read_text(encoding="utf-8"))
                history = data.get("logs", [])
            except:
                pass

        history.append(record)
        EVOLUTION_HISTORY_FILE.write_text(
            json.dumps({"logs": history[-50:]}, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

# 全局实例
evolution_manager_v2 = EvolutionManagerV2()
