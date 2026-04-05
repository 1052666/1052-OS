// ─── Health check / 心跳检测 (增强版) ────────────────────────────
// 支持指数退避重连、告警展示、监控状态显示

const HEALTH_INTERVAL = 30000;          // 正常轮询间隔 30 秒
const HEALTH_MAX_INTERVAL = 300000;     // 最大退避间隔 5 分钟
const HEALTH_BACKOFF_FACTOR = 2;        // 退避倍数

let _health_interval = HEALTH_INTERVAL;
let _health_timer = null;
let _health_fail_count = 0;

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(d + "天");
  if (h > 0) parts.push(h + "时");
  parts.push(m + "分");
  return parts.join("");
}

function hdot(cls) {
  return `<span class="im-status-dot ${cls}"></span>`;
}

function timeSince(isoStr) {
  if (!isoStr) return "未启动";
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60) return diff + "秒前";
  if (diff < 3600) return Math.floor(diff / 60) + "分前";
  return Math.floor(diff / 3600) + "时前";
}

async function fetchHealth() {
  try {
    const res = await fetch("/health");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // 成功 → 重置退避
    _health_fail_count = 0;
    _health_interval = HEALTH_INTERVAL;

    // ── 总体状态 ──────────────────────────────────────
    const allOk = data.ok && data.api_key;
    statusDot.className = "status-dot " + (allOk ? "ok" : "error");
    statusText.textContent = allOk ? "系统正常" : "系统异常";
    statusText.title = JSON.stringify(data, null, 2);

    // ── 详细指标 ──────────────────────────────────────
    const details = [];

    // API Key + Provider
    const providerName = data.provider?.type === "anthropic" ? "Claude" : "API";
    details.push(`${hdot(data.api_key ? "ok" : "")} ${providerName}`);

    // Telegram
    const tgOk = data.telegram?.enabled;
    if (tgOk !== undefined) {
      details.push(`${hdot(tgOk ? "ok" : "")} TG`);
    }

    // Lark
    const larkOk = data.lark?.enabled;
    if (larkOk !== undefined) {
      details.push(`${hdot(larkOk ? "ok" : "")} 飞书`);
    }

    // MCP
    if (data.mcp?.servers?.length) {
      const mcpOk = data.mcp.ok;
      details.push(`${hdot(mcpOk ? "ok" : "error")} MCP(${data.mcp.servers.length})`);
    }

    // Scheduler
    const tc = data.scheduler?.task_count || 0;
    if (tc > 0) {
      details.push(`${hdot("ok")} 任务:${tc}`);
    }

    // Evolution
    if (data.evolution?.active) {
      details.push(`${hdot("ok")} 进化中`);
    }

    // Monitor 后台探测时间
    if (data.monitor?.last_check) {
      details.push(`<span style="color:#6b7280" title="上次主动探测">🔍 ${timeSince(data.monitor.last_check)}</span>`);
    }

    // Uptime
    details.push(`<span style="color:#4b5563">⏱ ${formatUptime(data.uptime)}</span>`);

    const el = $("health-details");
    if (el) el.innerHTML = details.join(" ");

    // ── 告警展示 ──────────────────────────────────────
    renderAlerts(data.alerts || []);

  } catch (e) {
    _health_fail_count++;
    statusDot.className = "status-dot error";
    statusText.textContent = `连接失败 (${_health_fail_count})`;

    // 指数退避
    _health_interval = Math.min(
      HEALTH_INTERVAL * Math.pow(HEALTH_BACKOFF_FACTOR, _health_fail_count - 1),
      HEALTH_MAX_INTERVAL
    );

    const el = $("health-details");
    if (el) el.innerHTML = `<span style="color:#ef4444;font-size:10px">重连中 ${Math.round(_health_interval / 1000)}s</span>`;

    console.warn(`[Health] 连接失败 #${_health_fail_count}, ${Math.round(_health_interval / 1000)}s 后重试`);
  }

  // 调度下一次
  scheduleNext();
}

function scheduleNext() {
  if (_health_timer) clearTimeout(_health_timer);
  _health_timer = setTimeout(fetchHealth, _health_interval);
}

function renderAlerts(alerts) {
  let el = $("health-alerts");
  if (!alerts.length) {
    if (el) el.style.display = "none";
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "health-alerts";
    el.style.cssText = "max-height:60px;overflow-y:auto;font-size:10px;color:#92400e;background:#fef3c7;padding:4px 6px;border-radius:4px;margin-top:4px;display:none";
    const details = $("health-details");
    if (details) details.parentNode.insertBefore(el, details.nextSibling);
  }
  el.style.display = "block";
  el.innerHTML = alerts.map(a =>
    `<div style="margin:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a}</div>`
  ).join("");
}

// ── 启动心跳 ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  fetchHealth();
});
