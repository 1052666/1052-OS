// ─── Tool metadata ────────────────────────────────────────────────
const TOOL_META = {
  run_cmd:           { icon: "💻", label: "执行命令" },
  read_file:         { icon: "📄", label: "读取文件" },
  write_file:        { icon: "✏️",  label: "写入文件" },
  delete_path:       { icon: "🗑️", label: "删除路径" },
  list_dir:          { icon: "📁", label: "列出目录" },
  move_file:         { icon: "📦", label: "移动文件" },
  invoke_skill:      { icon: "🎯", label: "调用技能" },
  create_skill:        { icon: "🎯", label: "创建技能" },
  update_preferences:  { icon: "🧠", label: "更新偏好" },
  fetch_url_to_file: { icon: "⬇️", label: "下载文件" },
  create_output_file:{ icon: "📎", label: "生成文件" },
};

// ─── File helpers ─────────────────────────────────────────────────
const IMG_EXTS  = ["png","jpg","jpeg","gif","webp","svg","bmp","ico"];
const TEXT_EXTS = ["txt","md","json","csv","yaml","yml","py","js","ts","html","css",
                   "sh","bat","log","xml","toml","ini","sql","java","c","cpp","rs","go"];

function fileExt(url) {
  return (url.split("?")[0].split(".").pop() || "").toLowerCase();
}

function renderFileCard(url, filename) {
  const ext  = fileExt(url);
  const name = filename || url.split("/").pop();
  const card = document.createElement("div");
  card.className = "file-card";

  if (IMG_EXTS.includes(ext)) {
    card.innerHTML = `
      <div class="file-card-body">
        <span class="file-card-icon">🖼️</span>
        <span class="file-card-name">${escHtml(name)}</span>
      </div>
      <div class="file-card-footer">
        <button class="file-card-btn" onclick="openFilePreview('${escHtml(url)}','${escHtml(name)}','image')">👁 预览</button>
        <a href="${escHtml(url)}" download="${escHtml(name)}" class="file-card-btn">⬇ 下载</a>
      </div>`;
  } else if (TEXT_EXTS.includes(ext)) {
    card.innerHTML = `
      <div class="file-card-body">
        <span class="file-card-icon">📄</span>
        <span class="file-card-name">${escHtml(name)}</span>
      </div>
      <div class="file-card-footer">
        <button class="file-card-btn" onclick="openFilePreview('${escHtml(url)}','${escHtml(name)}','text')">👁 预览</button>
        <a href="${escHtml(url)}" download="${escHtml(name)}" class="file-card-btn">⬇ 下载</a>
      </div>`;
  } else {
    card.innerHTML = `
      <div class="file-card-body">
        <span class="file-card-icon">📎</span>
        <span class="file-card-name">${escHtml(name)}</span>
      </div>
      <div class="file-card-footer">
        <a href="${escHtml(url)}" download="${escHtml(name)}" class="file-card-btn">⬇ 下载</a>
      </div>`;
  }
  return card;
}

async function openFilePreview(url, name, type) {
  const modal = document.getElementById("file-preview-modal");
  document.getElementById("file-preview-title").textContent = name;
  const body = document.getElementById("file-preview-body");
  body.innerHTML = "";
  document.getElementById("file-preview-download").href = url;
  document.getElementById("file-preview-download").download = name;
  modal.style.display = "flex";

  if (type === "image") {
    const img = document.createElement("img");
    img.src = url;
    img.style.cssText = "max-width:100%;max-height:70vh;border-radius:6px;display:block;margin:0 auto";
    body.appendChild(img);
  } else {
    body.textContent = "加载中...";
    try {
      const text = await fetch(url).then(r => r.text());
      body.textContent = text;
    } catch { body.textContent = "加载失败"; }
  }
}

function closeFilePreview() {
  document.getElementById("file-preview-modal").style.display = "none";
}

// ─── Conversation history ─────────────────────────────────────────

async function loadConversationHistory() {
  try {
    const res = await fetch("/conversation");
    const { messages } = await res.json();
    if (!messages || messages.length === 0) return;

    state.messages = messages.map(m => ({ role: m.role, content: m.content }));
    if (welcome) welcome.style.display = "none";

    messages.forEach(m => {
      const role = m.role === "user" ? "user" : "ai";
      const platform = m.platform || "unknown";
      const platformLabel = platform !== "web" ? ` [${platform}]` : "";

      // 添加平台标识到消息内容
      if (role === "user" && platformLabel) {
        appendMessage(role, m.content, platformLabel);
      } else {
        appendMessage(role, m.content);
      }
    });

    updateMsgCount();
    scrollToBottom();
  } catch {
    // silently ignore if server not ready
  }
}

// ─── Send message ─────────────────────────────────────────────────

async function sendMessage() {
  if (state.isStreaming) return;
  const text = userInput.value.trim();
  if (!text) return;

  applySettings();
  const { model } = state.settings;
  if (!model) { alert("请先选择或输入模型名称！"); return; }

  if (welcome) welcome.style.display = "none";

  state.messages.push({ role: "user", content: text });
  updateMsgCount();
  appendMessage("user", text);
  userInput.value = "";
  autoResizeTextarea();

  const aiRow = appendMessage("ai", "");
  const bubble = aiRow.querySelector(".bubble");
  bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';

  setStreaming(true);

  try {
    state.abortController = new AbortController();

    const resp = await fetch("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: state.abortController.signal,
      body: JSON.stringify({
        messages: state.messages,
        temperature: state.settings.temperature,
      }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    bubble.innerHTML = "";

    let fullText      = "";
    let currentSegText = "";
    let currentTextEl  = null;
    let sseBuffer      = "";  // 缓冲跨 chunk 的不完整 SSE 行

    // ── RAF batching: collect tokens, flush once per animation frame ──
    let tokenBuffer = "";
    let rafId = null;

    function flushTokenBuffer() {
      rafId = null;
      if (!tokenBuffer) return;
      if (!currentTextEl || bubble.lastElementChild !== currentTextEl) {
        currentSegText = "";
        currentTextEl  = document.createElement("div");
        currentTextEl.className = "seg-text";
        bubble.appendChild(currentTextEl);
      }
      currentSegText += tokenBuffer;
      fullText       += tokenBuffer;
      tokenBuffer     = "";
      currentTextEl.textContent = currentSegText;  // plain text during stream
      scrollToBottom();
    }

    function finalizeTextEl() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (tokenBuffer) {
        if (!currentTextEl || bubble.lastElementChild !== currentTextEl) {
          currentSegText = "";
          currentTextEl  = document.createElement("div");
          currentTextEl.className = "seg-text";
          bubble.appendChild(currentTextEl);
        }
        currentSegText += tokenBuffer;
        fullText       += tokenBuffer;
        tokenBuffer     = "";
      }
      if (currentTextEl && currentSegText) {
        // 处理 <think> 标签：隐藏思考内容
        const processedText = processThinkTags(currentSegText);
        currentTextEl.innerHTML = marked.parse(processedText);
        addCopyButtons(currentTextEl);
      }
    }

    // 处理 <think>...</think> 标签，将其转换为可折叠的思考块
    function processThinkTags(text) {
      if (!text.includes("<think>")) return text;

      // 匹配 <think>...</think>，包括跨行的情况
      return text.replace(/<think>([\s\S]*?)<\/think>/g, (match, content) => {
        // 去掉首尾空白
        const trimmedContent = content.trim();
        if (!trimmedContent) return "";

        // 生成唯一ID
        const thinkId = "think-" + Math.random().toString(36).substr(2, 9);

        // 返回可折叠的 HTML
        return `<details class="think-block" id="${thinkId}">
<summary>💭 思考过程</summary>
<div class="think-content">\n\n${trimmedContent}\n\n</div>
</details>`;
      });
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, {stream: true});
      sseBuffer += chunk;
      const lines = sseBuffer.split("\n");
      // 最后一个元素可能是不完整的行，保留到下次
      sseBuffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        let data;
        try { data = JSON.parse(jsonStr); } catch { continue; }

        if (data.type === "delta") {
          bubble.querySelector(".typing-dots")?.remove();
          tokenBuffer += data.content;
          if (!rafId) rafId = requestAnimationFrame(flushTokenBuffer);

        } else if (data.type === "tool_call") {
          bubble.querySelector(".typing-dots")?.remove();
          finalizeTextEl();
          currentTextEl  = null;
          currentSegText = "";
          bubble.appendChild(createToolBlock(data.id, data.name, data.args, data.source));
          scrollToBottom();

        } else if (data.type === "tool_result") {
          const block = bubble.querySelector(`[data-tool-id="${data.id}"]`);
          if (block) {
            updateToolResult(block, data.result);
            // 文件卡片直接追加到 bubble，不受 tool-result-wrap 高度限制
            const fm = data.result.match(/\[FILE_URL:([^\]]+)\]/);
            if (fm) {
              bubble.appendChild(renderFileCard(fm[1], fm[1].split("/").pop()));
            }
          }
          scrollToBottom();

        } else if (data.type === "done") {
          finalizeTextEl();
          scrollToBottom();

        } else if (data.type === "error") {
          bubble.innerHTML = `<span style="color:#ef4444">⚠️ 错误: ${escHtml(data.content)}</span>`;
          setStatus("error", "请求出错");
        }
      }
    }

    // 处理 decoder 中残余的字节 + sseBuffer 中残余的行
    const trailing = decoder.decode() + sseBuffer;
    if (trailing.startsWith("data: ")) {
      try {
        const data = JSON.parse(trailing.slice(6).trim());
        if (data.type === "done") finalizeTextEl();
      } catch {}
    }

    if (fullText) {
      state.messages.push({ role: "assistant", content: fullText });
      updateMsgCount();
    }

  } catch (err) {
    if (err.name === "AbortError") {
      const stopNote = document.createElement("em");
      stopNote.style.cssText = "color:#9ca3af;font-size:12px;display:block;margin-top:4px";
      stopNote.textContent = "已停止生成";
      bubble.appendChild(stopNote);
    } else {
      bubble.innerHTML = `<span style="color:#ef4444">⚠️ 连接失败: ${escHtml(err.message)}</span>`;
      setStatus("error", "连接失败");
    }
  } finally {
    setStreaming(false);
  }
}

// ─── Stop / Clear ─────────────────────────────────────────────────

function stopStreaming() {
  if (state.abortController) state.abortController.abort();
}

function clearChat() {
  state.messages = [];
  msgs.innerHTML = "";
  if (welcome) {
    msgs.appendChild(welcome);
    welcome.style.display = "";
  }
  updateMsgCount();
  fetch("/conversation", { method: "DELETE" }).catch(() => {});
}

function updateMsgCount() {
  const el = $("msg-count");
  if (!el) return;
  const n = state.messages.length;
  el.innerHTML = `${n} <span>条消息</span>`;
}

// ─── UI helpers ───────────────────────────────────────────────────

// ─── Think tag processing (global) ───────────────────────────────

function processThinkTagsStatic(text) {
  if (!text.includes("<think>")) return text;
  return text.replace(/<think>([\s\S]*?)<\/think>/g, (match, content) => {
    const trimmed = content.trim();
    if (!trimmed) return "";
    const id = "think-" + Math.random().toString(36).substr(2, 9);
    return `<details class="think-block" id="${id}">
<summary>💭 思考过程</summary>
<div class="think-content">\n\n${trimmed}\n\n</div>
</details>`;
  });
}

function appendMessage(role, content, platformLabel = "") {
  const row    = document.createElement("div");
  row.className = `msg-row ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "🧑" : "🤖";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (content) {
    if (role === "user") {
      const platformTag = platformLabel ? `<span style="display:inline-block;background:#374151;color:#9ca3af;padding:2px 6px;border-radius:4px;font-size:10px;margin-right:6px;font-weight:600">${escHtml(platformLabel)}</span>` : "";
      bubble.innerHTML = platformTag + escHtml(content).replace(/\n/g, "<br>");
    } else {
      // 处理 think 标签后再渲染
      const processedContent = processThinkTagsStatic(content);
      bubble.innerHTML = marked.parse(processedContent);
      addCopyButtons(bubble);
    }
  }

  row.appendChild(avatar);
  row.appendChild(bubble);
  msgs.appendChild(row);
  scrollToBottom();
  return row;
}

function addCopyButtons(container) {
  container.querySelectorAll("pre").forEach(pre => {
    if (pre.querySelector(".copy-btn")) return;
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "复制";
    btn.addEventListener("click", () => {
      const code = pre.querySelector("code");
      navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
      btn.textContent = "✓";
      setTimeout(() => btn.textContent = "复制", 1500);
    });
    pre.appendChild(btn);
  });
}

function setStreaming(val) {
  state.isStreaming = val;
  sendBtn.disabled  = val;
  stopBtn.classList.toggle("visible", val);
  userInput.placeholder = val
    ? "等待回复中..."
    : "输入消息... (Enter 发送，Shift+Enter 换行)";
}

function scrollToBottom() {
  msgs.scrollTop = msgs.scrollHeight;
}

// ─── Tool block helpers ───────────────────────────────────────────

function fmtArgs(name, args) {
  if (name === "run_cmd")     return `$ ${args.command || ""}${args.cwd ? `  (cwd: ${args.cwd})` : ""}`;
  if (name === "read_file")   return `path: ${args.path || ""}`;
  if (name === "write_file")  return `path: ${args.path || ""}  mode: ${args.mode || "write"}`;
  if (name === "delete_path") return `path: ${args.path || ""}`;
  if (name === "list_dir")    return `path: ${args.path || "."}${args.pattern ? `  pattern: ${args.pattern}` : ""}`;
  if (name === "move_file")          return `${args.src || ""}  →  ${args.dst || ""}`;
  if (name === "fetch_url_to_file")  return `${args.url || ""}  →  ${args.path || args.filename || ""}`;
  if (name === "create_skill")       return `name: ${args.name || ""}${args.scripts ? " (含脚本)" : ""}`;
  if (name === "update_preferences") return "更新用户偏好";
  return JSON.stringify(args);
}

function createToolBlock(id, name, args, source) {
  const meta = TOOL_META[name] || { icon: "🔧", label: name };
  const isMCP = source && source.startsWith("MCP:");
  const srcBadge = source
    ? `<span class="tool-source${isMCP ? "" : " builtin"}">${escHtml(source)}</span>`
    : "";
  const displayName = name.replace(/^mcp_[^_]+_/, "");
  const block = document.createElement("div");
  block.className = "tool-block";
  block.dataset.toolId = id;
  block.innerHTML = `
    <div class="tool-header">
      <span class="tool-icon">${meta.icon}</span>
      <span class="tool-name">${escHtml(displayName)}</span>
      ${srcBadge}
      <span class="tool-status running"><span class="tool-spinner"></span> 执行中</span>
    </div>
    <div class="tool-args">${escHtml(fmtArgs(name, args))}</div>
    <div class="tool-result-wrap" style="display:none"><pre></pre></div>`;
  return block;
}

function updateToolResult(block, result) {
  const status  = block.querySelector(".tool-status");
  const wrap    = block.querySelector(".tool-result-wrap");
  const pre     = block.querySelector("pre");
  const isError = result.startsWith("执行失败:");
  status.className   = `tool-status ${isError ? "error" : "done"}`;
  status.textContent = isError ? "失败" : "完成";

  // 解析 [FILE_URL:...] 标记
  // 去掉 FILE_URL 标记，只显示干净的路径文本
  pre.textContent    = result.replace(/\[FILE_URL:[^\]]+\]/, "").trim();
  wrap.style.display = "block";
}
