/* ─── Scheduler Panel ─────────────────────────────────────── */

let schedulerTasks = [];

async function loadScheduler() {
  try {
    const res = await fetch('/tasks');
    const data = await res.json();
    schedulerTasks = data.tasks || [];
    renderSchedulerList();
  } catch (e) {
    document.getElementById('scheduler-list').innerHTML =
      '<div style="font-size:12px;color:#ef4444;padding:8px 0">加载失败</div>';
  }
}

function renderSchedulerList() {
  const el = document.getElementById('scheduler-list');
  if (!schedulerTasks.length) {
    el.innerHTML = '<div style="font-size:12px;color:#6b7280;text-align:center;padding:8px 0">暂无定时任务</div>';
    return;
  }
  el.innerHTML = schedulerTasks.map(t => `
    <div class="sched-card" data-id="${t.id}">
      <div class="sched-card-header">
        <span class="sched-toggle ${t.enabled ? 'on' : 'off'}" data-id="${t.id}" title="${t.enabled ? '点击禁用' : '点击启用'}">
          ${t.enabled ? '●' : '○'}
        </span>
        <span class="sched-name">${escHtml(t.name)}</span>
      </div>
      <div class="sched-meta">
        <span>⏰ ${escHtml(t.schedule)}</span>
        <span>下次: ${escHtml(t.next_run_fmt || '—')}</span>
        <span>已执行 ${t.run_count || 0} 次</span>
      </div>
      <div class="sched-actions">
        <button class="sched-btn" onclick="schedRunNow('${t.id}')">▶ 立即执行</button>
        <button class="sched-btn" onclick="schedViewCtx('${t.id}','${escHtml(t.name)}')">📄 上下文</button>
        <button class="sched-btn" onclick="schedEdit('${t.id}')">✏️ 编辑</button>
        <button class="sched-btn danger" onclick="schedDelete('${t.id}','${escHtml(t.name)}')">🗑</button>
      </div>
    </div>
  `).join('');

  // toggle enable/disable
  el.querySelectorAll('.sched-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const task = schedulerTasks.find(t => t.id === id);
      if (!task) return;
      await fetch(`/tasks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !task.enabled }),
      });
      loadScheduler();
    });
  });
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function schedRunNow(id) {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = '执行中...';
  try {
    const res = await fetch(`/tasks/${id}/run`, { method: 'POST' });
    const data = await res.json();
    alert('执行完成！\n\n' + (data.result || '').slice(0, 400));
    loadScheduler();
  } catch (e) {
    alert('执行失败: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ 立即执行';
  }
}

async function schedViewCtx(id, name) {
  const modal = document.getElementById('sched-ctx-modal');
  document.getElementById('sched-ctx-title').textContent = `上下文 — ${name}`;
  document.getElementById('sched-ctx-body').textContent = '加载中...';
  document.getElementById('sched-ctx-task-id').value = id;
  modal.style.display = 'flex';
  try {
    const res = await fetch(`/tasks/${id}/context`);
    const data = await res.json();
    document.getElementById('sched-ctx-body').textContent = data.content || '(暂无)';
  } catch (e) {
    document.getElementById('sched-ctx-body').textContent = '加载失败';
  }
}

async function schedClearCtx() {
  const id = document.getElementById('sched-ctx-task-id').value;
  if (!confirm('确定清空该任务的执行记录？')) return;
  await fetch(`/tasks/${id}/context`, { method: 'DELETE' });
  document.getElementById('sched-ctx-body').textContent = '(已清空)';
}

function schedCloseCtx() {
  document.getElementById('sched-ctx-modal').style.display = 'none';
}

function schedEdit(id) {
  const task = schedulerTasks.find(t => t.id === id);
  if (!task) return;
  openSchedForm(task);
}

async function schedDelete(id, name) {
  if (!confirm(`确定删除任务「${name}」？`)) return;
  await fetch(`/tasks/${id}`, { method: 'DELETE' });
  loadScheduler();
}

// ─── Form ──────────────────────────────────────────────────
function openSchedForm(task) {
  const form = document.getElementById('sched-form-wrap');
  const title = document.getElementById('sched-form-title');

  if (task) {
    title.textContent = '编辑定时任务';
    document.getElementById('sched-f-id').value = task.id;
    document.getElementById('sched-f-name').value = task.name;
    document.getElementById('sched-f-prompt').value = task.prompt;
    document.getElementById('sched-f-schedule').value = task.schedule;
  } else {
    title.textContent = '新建定时任务';
    document.getElementById('sched-f-id').value = '';
    document.getElementById('sched-f-name').value = '';
    document.getElementById('sched-f-prompt').value = '';
    document.getElementById('sched-f-schedule').value = 'daily:09:00';
  }

  form.style.display = 'block';
}

function closeSchedForm() {
  document.getElementById('sched-form-wrap').style.display = 'none';
}

async function submitSchedForm() {
  const id = document.getElementById('sched-f-id').value;

  const body = {
    name:        document.getElementById('sched-f-name').value.trim(),
    prompt:      document.getElementById('sched-f-prompt').value.trim(),
    schedule:    document.getElementById('sched-f-schedule').value.trim(),
  };

  if (!body.name || !body.prompt || !body.schedule) {
    alert('请填写任务名称、提示词和调度表达式');
    return;
  }

  if (id) {
    await fetch(`/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } else {
    await fetch('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  closeSchedForm();
  loadScheduler();
}

// ─── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('sched-add-btn')?.addEventListener('click', () => openSchedForm(null));
  document.getElementById('sched-refresh-btn')?.addEventListener('click', loadScheduler);
  document.getElementById('sched-form-cancel')?.addEventListener('click', closeSchedForm);
  document.getElementById('sched-form-submit')?.addEventListener('click', submitSchedForm);
  document.getElementById('sched-ctx-close')?.addEventListener('click', schedCloseCtx);
  document.getElementById('sched-ctx-clear')?.addEventListener('click', schedClearCtx);
});
