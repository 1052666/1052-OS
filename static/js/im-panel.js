// ─── IM Integration Panel ────────────────────────────────────────

async function loadIMConfig() {
  try {
    const res = await fetch("/im/config");
    const data = await res.json();

    // Telegram
    $("im-tg-enabled").checked = data.telegram?.enabled || false;
    $("im-tg-token").value = "";
    $("im-tg-token").placeholder = data.telegram?.token_set
      ? `已配置 (${data.telegram.token_hint})，留空不修改`
      : "Bot Token from @BotFather";

    // Lark
    $("im-lark-enabled").checked = data.lark?.enabled || false;
    $("im-lark-appid").value = "";
    $("im-lark-appid").placeholder = data.lark?.app_id_set
      ? `已配置 (${data.lark.app_id})，留空不修改`
      : "cli_xxxxxxxxxxxx";
    $("im-lark-secret").value = "";
    $("im-lark-secret").placeholder = data.lark?.app_secret_set ? "已配置，留空不修改" : "";
    $("im-lark-encrypt").value = "";
    $("im-lark-encrypt").placeholder = data.lark?.encrypt_key_set ? "已配置，留空不修改" : "Encrypt Key (可选)";
    $("im-lark-verify").value = "";
    $("im-lark-verify").placeholder = data.lark?.verification_token_set ? "已配置，留空不修改" : "Verification Token (可选)";

    // 微信
    $("im-wx-enabled").checked = data.wechat?.enabled || false;
    $("im-wx-primary").value = data.wechat?.primary_chat || "";
    $("im-wx-primary").placeholder = "主监听窗口（好友备注或群聊名称）";
    $("im-wx-botname").value = data.wechat?.bot_name || "";
    $("im-wx-botname").placeholder = data.wechat?.bot_name_auto ? `已自动检测: ${data.wechat.bot_name_auto}` : "机器人名称（当前微信昵称，用于群聊@识别）";

    renderIMStatus(data);
  } catch (e) {
    console.error("[IM] 加载配置失败:", e);
  }
}

function renderIMStatus(data) {
  const el = $("im-status-list");
  if (!el) return;

  const items = [];
  if (data.telegram?.enabled) {
    items.push(`<span class="im-status-dot ok"></span> Telegram`);
  } else {
    items.push(`<span class="im-status-dot"></span> Telegram`);
  }
  if (data.lark?.enabled) {
    items.push(`<span class="im-status-dot ok"></span> 飞书`);
  } else {
    items.push(`<span class="im-status-dot"></span> 飞书`);
  }
  if (data.wechat?.enabled) {
    items.push(`<span class="im-status-dot ok"></span> 微信`);
  } else {
    items.push(`<span class="im-status-dot"></span> 微信`);
  }
  el.innerHTML = items.join(" · ");
}

async function saveIMConfig() {
  const body = {
    telegram: {
      enabled: $("im-tg-enabled").checked,
      token: $("im-tg-token").value.trim(),
    },
    lark: {
      enabled: $("im-lark-enabled").checked,
      app_id: $("im-lark-appid").value.trim(),
      app_secret: $("im-lark-secret").value.trim(),
      encrypt_key: $("im-lark-encrypt").value.trim(),
      verification_token: $("im-lark-verify").value.trim(),
    },
    wechat: {
      enabled: $("im-wx-enabled").checked,
      primary_chat: $("im-wx-primary").value.trim(),
      bot_name: $("im-wx-botname").value.trim(),
    },
  };

  try {
    await fetch("/im/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // 刷新 placeholder
    await loadIMConfig();
    flashBtn($("im-save-btn"), "✓ 已保存");
  } catch (e) {
    alert("保存失败: " + e.message);
  }
}

async function reloadIM() {
  try {
    const res = await fetch("/im/reload", { method: "POST" });
    const data = await res.json();
    renderIMStatus({ telegram: data.telegram, lark: data.lark, wechat: data.wechat });
    flashBtn($("im-reload-btn"), "✓ 已重载");
  } catch (e) {
    alert("重载失败: " + e.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("im-save-btn")?.addEventListener("click", saveIMConfig);
  $("im-reload-btn")?.addEventListener("click", reloadIM);
});
