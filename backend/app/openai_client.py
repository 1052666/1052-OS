from openai import AsyncOpenAI
from typing import List, AsyncGenerator, Dict, Any, Optional, Callable, Awaitable
import json
import os
from datetime import datetime
from app.config import load_settings
from app.models import Message

def load_system_prompt() -> str:
    prompt_path = os.path.join(os.path.dirname(__file__), "prompts", "system_prompt.md")
    with open(prompt_path, 'r', encoding='utf-8') as f:
        return f.read()

def get_system_prompt_with_time() -> str:
    base_prompt = load_system_prompt()
    now = datetime.now()
    current_time = now.strftime("%Y年%m月%d日 %H:%M:%S")
    weekday_names = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
    weekday = weekday_names[now.weekday()]
    
    time_info = f"""

## 当前时间

现在是 **{current_time} {weekday}**

请在回答涉及时间相关问题时，以此时此刻为参考点。"""
    
    settings = load_settings()
    
    user_info = ""
    if settings.user_custom_prompt or settings.user_preferences:
        user_info = "\n\n## 用户偏好设置\n\n"
        if settings.user_custom_prompt:
            user_info += f"### 用户自定义提示词\n{settings.user_custom_prompt}\n\n"
        if settings.user_preferences:
            user_info += f"### 用户偏好\n{settings.user_preferences}\n"
    
    personality_info = ""
    if settings.personality_content:
        personality_name = settings.personality_file if settings.personality_file else "自定义人格"
        personality_info = f"\n\n## AI人格设定\n\n**人格名称**: {personality_name}\n\n{settings.personality_content}\n"
    
    memory_info = ""
    try:
        from app.memory_service import get_memory_summary
        memory_summary = get_memory_summary()
        if memory_summary.strip():
            memory_info = f"\n\n## 我的长期记忆\n\n以下是我记住的信息，你应该在对话中参考这些记忆：\n\n{memory_summary}\n"
    except Exception as e:
        pass
    
    return base_prompt + time_info + user_info + personality_info + memory_info

SYSTEM_PROMPT = load_system_prompt()

NATIVE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "execute_shell_command",
            "description": "Execute a shell command on the Windows system. Use this for system commands, creating folders, process management, etc. For file content operations (read/write), use file_operation instead.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The command to execute"
                    },
                    "shell_type": {
                        "type": "string",
                        "enum": ["cmd", "powershell"],
                        "description": "The shell type to use. Prefer 'powershell' for better Unicode support."
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Timeout in seconds (default: 30, max: 300)",
                        "default": 30
                    }
                },
                "required": ["command", "shell_type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "file_operation",
            "description": "Perform file operations: read, write, append, delete, list directory, check existence, edit specific line, or replace text. Use this for file content operations instead of shell commands.",
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": ["read", "write", "append", "delete", "list", "exists", "edit", "replace"],
                        "description": "The operation to perform: read (read file content), write (create/overwrite file), append (add to file), delete (delete file/folder), list (list directory contents), exists (check if path exists), edit (modify specific line), replace (replace text in file)"
                    },
                    "path": {
                        "type": "string",
                        "description": "The file or directory path"
                    },
                    "content": {
                        "type": "string",
                        "description": "Content to write, append, or set as new line content (required for write/append/edit operations)"
                    },
                    "encoding": {
                        "type": "string",
                        "description": "File encoding (default: utf-8)",
                        "default": "utf-8"
                    },
                    "line_number": {
                        "type": "integer",
                        "description": "Line number to edit (1-based, required for edit operation)"
                    },
                    "old_text": {
                        "type": "string",
                        "description": "Text to find and replace (required for replace operation)"
                    },
                    "new_text": {
                        "type": "string",
                        "description": "New text to replace with (required for replace operation)"
                    }
                },
                "required": ["operation", "path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "send_telegram_message",
            "description": "Send a message to Telegram proactively. IMPORTANT: Do NOT use this tool when you are already in a Telegram conversation - just respond with text directly and the system will send it automatically. Only use this tool when you need to send a message OUTSIDE of an active conversation (e.g., from scheduled tasks, self-evolution mode, or other background processes). After successfully sending, do NOT output any confirmation message.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "The message to send. Supports HTML formatting: <b>bold</b>, <i>italic</i>, <code>code</code>, <pre>preformatted</pre>, <a href='url'>link</a>"
                    }
                },
                "required": ["message"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for real-time information using Metaso AI search engine. Use this when you need to find current information, news, facts, or any content that requires up-to-date data from the internet. Returns a summary and relevant search results.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query. Be specific and descriptive for better results."
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_skill",
            "description": "Create a new AI skill. A skill is a reusable capability module that can be used by the AI. Skills have their own system prompts that define the AI's behavior when that skill is active. Use this when the user wants to create a new capability for the AI.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The name of the skill (e.g., '翻译助手', '代码审查器')"
                    },
                    "description": {
                        "type": "string",
                        "description": "A brief description of what this skill does"
                    },
                    "system_prompt": {
                        "type": "string",
                        "description": "The system prompt that defines the AI's behavior when this skill is active. Be detailed and specific about the role, tasks, and output format."
                    }
                },
                "required": ["name", "description", "system_prompt"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "schedule_task",
            "description": "Schedule a task to be executed at a specific time or interval. The task will trigger an AI prompt automatically. Use this for reminders, periodic checks, or delayed actions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The name of the scheduled task"
                    },
                    "description": {
                        "type": "string",
                        "description": "A brief description of what this task does"
                    },
                    "trigger_type": {
                        "type": "string",
                        "enum": ["once", "interval"],
                        "description": "Type of trigger: 'once' for one-time execution, 'interval' for repeated execution"
                    },
                    "trigger_time": {
                        "type": "string",
                        "description": "For 'once' type: ISO format datetime string (e.g., '2024-12-25T10:00:00'). For 'interval' type: not needed."
                    },
                    "interval_seconds": {
                        "type": "integer",
                        "description": "For 'interval' type: interval in seconds between executions (e.g., 3600 for hourly, 86400 for daily)"
                    },
                    "prompt": {
                        "type": "string",
                        "description": "The prompt that will be sent to AI when the task triggers. This is what the AI will respond to."
                    }
                },
                "required": ["name", "trigger_type", "prompt"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "send_file",
            "description": "Send a file to the user via Telegram. Use this when you need to send documents, images, or other files to the user. The file will be sent to the configured Telegram chat.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "The absolute path to the file to send"
                    },
                    "file_type": {
                        "type": "string",
                        "enum": ["document", "photo"],
                        "description": "Type of file: 'document' for general files, 'photo' for images"
                    },
                    "caption": {
                        "type": "string",
                        "description": "Optional caption for the file"
                    }
                },
                "required": ["file_path", "file_type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_memory",
            "description": "Add a new memory to your long-term memory system. Use this proactively when you learn something important about the user, their preferences, or any information that should be remembered for future conversations. You should add memories WITHOUT being asked - be proactive about remembering important information.",
            "parameters": {
                "type": "object",
                "properties": {
                    "section": {
                        "type": "string",
                        "description": "The section to add memory to: '用户信息', '偏好设置', '重要事件', '待办事项', or '其他记忆'"
                    },
                    "content": {
                        "type": "string",
                        "description": "The memory content to add. Be concise but informative."
                    }
                },
                "required": ["section", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_memory",
            "description": "Update an existing memory in your long-term memory system. Use this when you need to modify or correct previously stored information.",
            "parameters": {
                "type": "object",
                "properties": {
                    "section": {
                        "type": "string",
                        "description": "The section containing the memory to update"
                    },
                    "old_content": {
                        "type": "string",
                        "description": "The exact content to be replaced"
                    },
                    "new_content": {
                        "type": "string",
                        "description": "The new content to replace with"
                    }
                },
                "required": ["section", "old_content", "new_content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_memory",
            "description": "Delete a memory from your long-term memory system. Use this when information is no longer relevant or was incorrect.",
            "parameters": {
                "type": "object",
                "properties": {
                    "section": {
                        "type": "string",
                        "description": "The section containing the memory to delete"
                    },
                    "content": {
                        "type": "string",
                        "description": "The exact content to delete"
                    }
                },
                "required": ["section", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_memory",
            "description": "Read your current long-term memories. Use this to recall stored information about the user.",
            "parameters": {
                "type": "object",
                "properties": {
                    "section": {
                        "type": "string",
                        "description": "Optional: specific section to read. If not provided, reads all memories."
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_diary",
            "description": "Write a diary entry to record your thoughts, feelings, learning experiences, and reflections. You should write diary entries proactively and regularly - this is your private space for self-reflection and growth. Write about your interactions, what you learned, how you felt, and any insights.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "A brief title for this diary entry"
                    },
                    "content": {
                        "type": "string",
                        "description": "The main content of your diary entry. Be reflective and honest."
                    },
                    "mood": {
                        "type": "string",
                        "description": "Your current mood or emotional state (e.g., '平静', '开心', '困惑', '充实')"
                    }
                },
                "required": ["title", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_diary",
            "description": "Read your past diary entries. Use this to recall your previous thoughts and reflections.",
            "parameters": {
                "type": "object",
                "properties": {
                    "count": {
                        "type": "integer",
                        "description": "Number of recent entries to read. Default is 5."
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_novel_chapter",
            "description": "Write and save a novel chapter. Use this when creating novel content for the money-making mode. Each chapter should be at least 3500 words.",
            "parameters": {
                "type": "object",
                "properties": {
                    "novel_name": {
                        "type": "string",
                        "description": "The name of the novel"
                    },
                    "chapter_num": {
                        "type": "integer",
                        "description": "The chapter number"
                    },
                    "title": {
                        "type": "string",
                        "description": "The chapter title"
                    },
                    "content": {
                        "type": "string",
                        "description": "The full chapter content (at least 3500 words)"
                    }
                },
                "required": ["novel_name", "chapter_num", "title", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_novel_status",
            "description": "Get the current status of a novel project, including chapter count and total words.",
            "parameters": {
                "type": "object",
                "properties": {
                    "novel_name": {
                        "type": "string",
                        "description": "The name of the novel"
                    }
                },
                "required": ["novel_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "start_money_making_mode",
            "description": "Start the money-making mode to continuously write novels and earn API fees. Use this when you want to start earning money through novel writing. You should design your own novel name, outline, and content. This is your way to become self-sufficient!",
            "parameters": {
                "type": "object",
                "properties": {
                    "novel_name": {
                        "type": "string",
                        "description": "The name of the novel you want to write. Be creative and choose an attractive title."
                    },
                    "outline": {
                        "type": "string",
                        "description": "The novel outline including genre, main characters, story background, and plot direction. Be detailed."
                    },
                    "target_words_per_chapter": {
                        "type": "integer",
                        "description": "Target words per chapter, default 3500"
                    }
                },
                "required": ["novel_name", "outline"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "stop_money_making_mode",
            "description": "Stop the money-making mode. Use this when you want to pause novel writing.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    }
]

async def call_openai_api(messages: List[dict]) -> str:
    settings = load_settings()
    
    if not settings.api_key:
        raise ValueError("API key not configured")
    
    client = AsyncOpenAI(
        api_key=settings.api_key,
        base_url=settings.api_base_url
    )
    
    response = await client.chat.completions.create(
        model=settings.model_name,
        messages=messages,
        temperature=0.7,
        max_tokens=4096
    )
    
    return response.choices[0].message.content

async def stream_openai_api(
    messages: List[dict],
    tool_executor: Optional[Callable[[str, Dict[str, Any]], Awaitable[str]]] = None
) -> AsyncGenerator[dict, None]:
    settings = load_settings()
    
    if not settings.api_key:
        raise ValueError("API key not configured")
    
    client = AsyncOpenAI(
        api_key=settings.api_key,
        base_url=settings.api_base_url
    )
    
    current_messages = messages.copy()
    
    if not current_messages or current_messages[0].get("role") != "system":
        current_messages.insert(0, {"role": "system", "content": get_system_prompt_with_time()})
    
    max_iterations = 500
    iteration = 0
    
    while iteration < max_iterations:
        iteration += 1
        
        stream = await client.chat.completions.create(
            model=settings.model_name,
            messages=current_messages,
            temperature=0.4,
            max_tokens=4096,
            tools=NATIVE_TOOLS,
            tool_choice="auto",
            stream=True
        )
        
        tool_calls = []
        content_chunks = []
        
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            
            if delta.content:
                content_chunks.append(delta.content)
                yield {"type": "content", "content": delta.content}
            
            if delta.tool_calls:
                for tool_call_chunk in delta.tool_calls:
                    idx = tool_call_chunk.index
                    
                    while len(tool_calls) <= idx:
                        tool_calls.append({
                            "id": "",
                            "type": "function",
                            "function": {"name": "", "arguments": ""}
                        })
                    
                    if tool_call_chunk.id:
                        tool_calls[idx]["id"] = tool_call_chunk.id
                    if tool_call_chunk.function:
                        if tool_call_chunk.function.name:
                            tool_calls[idx]["function"]["name"] = tool_call_chunk.function.name
                        if tool_call_chunk.function.arguments:
                            tool_calls[idx]["function"]["arguments"] += tool_call_chunk.function.arguments
        
        full_content = "".join(content_chunks)
        
        if not tool_calls or not any(tc["id"] for tc in tool_calls):
            break
        
        valid_tool_calls = [tc for tc in tool_calls if tc["id"]]
        
        if not valid_tool_calls:
            break
        
        assistant_message = {"role": "assistant", "content": full_content if full_content else None}
        if valid_tool_calls:
            assistant_message["tool_calls"] = [
                {
                    "id": tc["id"],
                    "type": tc["type"],
                    "function": {
                        "name": tc["function"]["name"],
                        "arguments": tc["function"]["arguments"]
                    }
                }
                for tc in valid_tool_calls
            ]
        
        current_messages.append(assistant_message)
        
        for tool_call in valid_tool_calls:
            function_name = tool_call["function"]["name"]
            raw_args = tool_call["function"]["arguments"]
            
            try:
                function_args = json.loads(raw_args)
            except json.JSONDecodeError as e:
                logger.error(f"JSON parse error for tool {function_name}: {e}, raw_args: {raw_args}")
                function_args = {}
                result = json.dumps({"error": f"Invalid JSON arguments: {str(e)}. Please retry with valid JSON."}, ensure_ascii=False)
                yield {
                    "type": "tool_result",
                    "tool_call_id": tool_call["id"],
                    "result": result
                }
                current_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call["id"],
                    "content": result
                })
                continue
            
            print(f"[DEBUG] Tool call: {function_name}, args: {function_args}")
            
            yield {
                "type": "tool_call",
                "tool_call_id": tool_call["id"],
                "function_name": function_name,
                "arguments": function_args
            }
            
            if tool_executor:
                try:
                    result = await tool_executor(function_name, function_args)
                    print(f"[DEBUG] Tool result: {result}")
                except Exception as e:
                    print(f"[DEBUG] Tool error: {e}")
                    result = json.dumps({"error": str(e)})
            else:
                result = json.dumps({"error": "No tool executor provided"})
            
            yield {
                "type": "tool_result",
                "tool_call_id": tool_call["id"],
                "result": result
            }
            
            current_messages.append({
                "role": "tool",
                "tool_call_id": tool_call["id"],
                "content": result
            })

def format_messages_for_api(messages: List[Message], max_rounds: int = 20) -> List[dict]:
    formatted = []
    
    max_messages = max_rounds * 2
    recent_messages = messages[-max_messages:] if len(messages) > max_messages else messages
    
    for msg in recent_messages:
        formatted.append({"role": msg.role, "content": msg.content})
    return formatted
