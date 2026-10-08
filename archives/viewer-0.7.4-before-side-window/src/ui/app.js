/* UI knows only the narrow preload API. Authentication tokens stay in the main process. */
const api = window.laf;
const isEditor = true; // This renderer is included only in the standalone editor package.
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
let settings, user = null, snapshot = { items: [] }, page = 'items', authMode = 'login', timer, loading = false, editing = false;
let search = '', filter = 'found';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statusLabel = value => ({ found: '未认领', claimed: '已认领', pending: '待批准', approved: '已批准', rejected: '已拒绝', disabled: '已停用' }[value] ?? value);
const timeLabel = value => value ? new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toLocaleString('zh-CN') : '未填写';
let noticeTimer;
function notice(text) { const node = document.querySelector('#notice'); node.textContent = text; node.hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => node.hidden = true, 6500); }
async function action(fn) { try { return await fn(); } catch (error) { notice(error.message); } }
function button(id, fn) { document.getElementById(id)?.addEventListener('click', () => action(fn)); }
function openModal(html) { modal.innerHTML = html; if (!modal.open) modal.showModal(); button('modal-close', () => modal.close()); }
modal.addEventListener('close', () => { editing = false; });
function dialogHead(title) { return `<div class="dialog-head"><h2>${title}</h2><button class="quiet" id="modal-close" aria-label="关闭">✕</button></div>`; }
function renderShell() {
  const brand = `<div class="brand"><div class="brand-icon">L</div><div><h1>失物招领</h1><div class="muted">让遗失的物品，回到主人身边</div></div></div>`;
  {
    app.innerHTML = `<div class="editor-shell"><aside class="sidebar"><div class="brand"><div class="brand-icon">L</div><strong>失物招领<br><span class="muted">编辑工作台</span></strong></div><button id="nav-items">失物记录</button>${user?.role === 'admin' ? '<button id="nav-users">账号审批</button><button id="nav-logs">操作日志</button>' : ''}<button id="nav-password">修改密码</button><button id="settings-open">连接与设置</button><div class="account">${user ? `<p>${escape(user.username)} · ${user.role === 'admin' ? '管理员' : '编辑者'}</p><button id="logout">退出登录</button>` : '<p>登录后可维护失物记录</p>'}</div></aside><section class="workspace"><header class="header"><div class="row between"><div><h1 id="page-title">失物记录</h1><span class="muted">统一管理记录、图片与认领状态</span></div><button id="new-item" class="primary" ${!user ? 'hidden' : ''}>＋ 发布失物</button></div><div class="tools" id="item-tools"><input id="search" placeholder="搜索物品名称、描述或地点" aria-label="搜索失物"><select id="filter" aria-label="认领状态"><option value="found">未认领</option><option value="claimed">已认领</option><option value="all">全部</option></select><button id="refresh">刷新</button></div></header><main class="body" id="content"></main></section></div>`;
    button('nav-items', () => navigate('items'));
    button('nav-users', () => navigate('users'));
    button('nav-logs', () => navigate('logs'));
    button('nav-password', () => navigate('password'));
    button('new-item', () => itemForm());
    button('logout', async () => { await api.logout(); user = null; page = 'items'; renderShell(); renderAuth(); });
  }
  button('settings-open', settingsForm);
  button('refresh', () => refresh());
  document.querySelector('#search')?.addEventListener('input', event => { search = event.target.value; renderCards(); });
  const filterInput = document.querySelector('#filter');
  if (filterInput) { filterInput.value = filter; filterInput.addEventListener('change', event => { filter = event.target.value; renderCards(); }); }
  if (isEditor) {
    if (!user) renderAuth(); else navigate(page);
  } else renderCards();
}
function renderAuth() {
  document.querySelector('#item-tools').hidden = true;
  document.querySelector('#content').innerHTML = `<div class="auth"><h2>${authMode === 'login' ? '登录编辑工作台' : '申请编辑者账号'}</h2><p class="muted">浏览失物无需登录。编辑者账号由管理员批准后启用。</p><div class="tabs"><button id="auth-login" class="${authMode === 'login' ? 'primary' : ''}">登录</button><button id="auth-register" class="${authMode === 'register' ? 'primary' : ''}">申请账号</button></div><form id="auth-form"><div class="field"><label for="username">用户名</label><input id="username" name="username" required minlength="3" maxlength="40" autocomplete="username" placeholder="3–40 个字母、数字或中文"></div><div class="field"><label for="password">密码</label><input id="password" name="password" type="password" required minlength="10" maxlength="128" autocomplete="${authMode === 'login' ? 'current-password' : 'new-password'}" placeholder="至少 10 个字符"></div>${authMode === 'register' ? '<div class="field"><label for="confirm">确认密码</label><input id="confirm" name="confirm" type="password" required autocomplete="new-password"></div>' : ''}<button type="submit" class="primary">${authMode === 'login' ? '登录' : '提交申请'}</button><p id="auth-message" class="muted caption"></p></form><div class="hint">当前服务器：${escape(settings.serverUrl)}<br>首次使用时，由服务器维护者初始化管理员账号。</div></div>`;
  button('auth-login', () => { authMode = 'login'; renderAuth(); });
  button('auth-register', () => { authMode = 'register'; renderAuth(); });
  document.querySelector('#auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target, submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    try {
      const body = { username: form.username.value.trim(), password: form.password.value };
      if (authMode === 'register') {
        if (body.password !== form.confirm.value) throw new Error('两次密码不一致');
        await api.register(body); form.reset();
        document.querySelector('#auth-message').textContent = '申请已提交。请联系管理员审批，通过后在登录页登录。';
      } else { user = await api.login(body); renderShell(); await refresh(); }
    } catch (error) { document.querySelector('#auth-message').textContent = error.message; }
    finally { submit.disabled = false; }
  });
}
async function navigate(next) {
  page = next;
  if (!user) { renderAuth(); return; }
  for (const id of ['items', 'users', 'logs', 'password']) document.querySelector(`#nav-${id}`)?.classList.toggle('active', id === next);
  document.querySelector('#page-title').textContent = ({ items: '失物记录', users: '账号审批', logs: '操作日志', password: '修改密码' })[next];
  document.querySelector('#item-tools').hidden = next !== 'items';
  document.querySelector('#new-item').hidden = next !== 'items';
  const content = document.querySelector('#content');
  if (next === 'items') { content.innerHTML = '<div class="summary"><span id="count"></span><span id="sync"></span></div><div id="cards" class="cards"></div>'; renderCards(); }
  else if (next === 'users') await usersPage();
  else if (next === 'logs') await logsPage();
  else passwordPage();
}
async function refresh() {
  if (loading) return;
  loading = true;
  const refreshButton = document.querySelector('#refresh');
  if (refreshButton) refreshButton.disabled = true;
  try { snapshot = await api.records(true); if (page === 'items') renderCards(); }
  catch (error) { notice(error.message); if (!snapshot.items.length) { snapshot.error = error.message; renderCards(); } }
  finally { loading = false; if (refreshButton) refreshButton.disabled = false; }
}
function renderCards() {
  const container = document.querySelector('#cards');
  if (!container) return;
  const query = search.trim().toLowerCase();
  const items = snapshot.items.filter(item => (filter === 'all' || item.status === filter) && `${item.title} ${item.description ?? ''} ${item.floor ?? ''}`.toLowerCase().includes(query));
  document.querySelector('#count').textContent = `${items.length} 件物品`;
  document.querySelector('#sync').textContent = snapshot.offline ? '离线 · 显示本地缓存' : snapshot.missingImages ? `缺少 ${snapshot.missingImages} 张图片` : snapshot.syncedAt ? '已同步' : '等待同步';
  document.querySelector('#sync').classList.toggle('sync-warning', Boolean(snapshot.offline || snapshot.missingImages));
  const cacheTime = document.querySelector('#cache-time');
  if (cacheTime && snapshot.syncedAt) cacheTime.textContent = `缓存更新：${timeLabel(snapshot.syncedAt)}`;
  container.innerHTML = items.length ? items.map(item => `<button class="card" data-id="${item.id}"><div class="thumb placeholder" data-image="${escape(item.image_id)}">◇</div><div class="card-info"><div class="row between"><h3>${escape(item.title)}</h3><span class="badge ${escape(item.status)}">${statusLabel(item.status)}</span></div><p class="excerpt">${escape(item.description || '暂无物品描述')}</p><div class="muted">#${item.id} · ${escape(item.floor || '楼层未填写')}</div></div></button>`).join('') : `<div class="empty"><h3>${snapshot.error && !snapshot.syncedAt ? '暂时无法获取记录' : query ? '没有匹配的物品' : '暂无失物记录'}</h3><p>${escape(snapshot.error || '新记录同步后会显示在这里')}</p>${isEditor && user ? '<button id="empty-create" class="primary">发布第一件失物</button>' : ''}</div>`;
  container.querySelectorAll('[data-id]').forEach(node => node.addEventListener('click', () => action(() => detail(Number(node.dataset.id)))));
  button('empty-create', () => itemForm());
  for (const node of container.querySelectorAll('[data-image]')) {
    if (!node.dataset.image) continue;
    api.image(node.dataset.image).then(data => {
      if (!data || !node.isConnected) return;
      const img = document.createElement('img'); img.className = 'thumb'; img.alt = '失物图片'; img.src = data; node.replaceWith(img);
    }).catch(() => {});
  }
}
async function detail(id) {
  const item = snapshot.items.find(i => i.id === id);
  if (!item) return;
  const photo = await api.image(item.image_id);
  openModal(`${dialogHead(escape(item.title))}${photo ? `<img class="photo" src="${photo}" alt="${escape(item.title)}">` : '<div class="hint">暂无图片或图片尚未缓存</div>'}<span class="badge ${item.status}">${statusLabel(item.status)}</span><p class="description">${escape(item.description || '暂无描述')}</p><dl class="facts"><dt>序号</dt><dd>#${item.id}</dd><dt>出现楼层</dt><dd>${escape(item.floor || "未填写")}</dd><dt>录入时间</dt><dd>${timeLabel(item.created_at)}</dd></dl>${isEditor && user ? '<div class="actions"><button id="delete-item" class="danger">删除记录</button><button id="edit-item" class="primary">编辑记录</button></div>' : ''}`);
  button('edit-item', () => itemForm(item));
  button('delete-item', async () => {
    if (!confirm(`确认删除「${item.title}」？此操作无法撤销。`)) return;
    await api.api(`/api/items/${id}`, 'DELETE'); modal.close(); notice('记录已删除'); await refresh();
  });
}
async function itemForm(item = {}) {
  editing = true;
  let imageId = item.image_id ?? null;
  const uploaded = [];
  let retainedImage = null;
  const photo = await api.image(imageId);
  openModal(`${dialogHead(item.id ? `编辑记录 #${item.id}` : '发布失物记录')}<form id="item-form"><div class="form-grid"><div class="field span2"><label for="title">物品名称 *</label><input id="title" name="title" required maxlength="200" value="${escape(item.title)}" placeholder="例如：蓝色保温杯"></div><div class="field span2"><label for="description">物品描述</label><textarea id="description" name="description" maxlength="5000" placeholder="颜色、品牌、外观特征或领取说明">${escape(item.description)}</textarea></div><div class="field"><label for="floor">出现楼层</label><input id="floor" name="floor" maxlength="200" value="${escape(item.floor)}" placeholder="例如：二层"></div><div class="field"><label for="status">认领状态</label><select id="status" name="status"><option value="found">未认领</option><option value="claimed" ${item.status === 'claimed' ? 'selected' : ''}>已认领</option></select></div><div class="field span2"><label>物品图片</label><div class="upload"><div id="upload-preview">${photo ? `<img src="${photo}" alt="图片预览">` : '<span class="muted">尚未选择图片</span>'}</div><div><button type="button" id="upload-image">选择并上传图片</button><button type="button" id="remove-image" class="quiet">移除</button><div class="caption">PNG / JPEG / WebP，最大 5 MB</div><div class="caption" id="upload-name"></div></div></div></div></div><p id="form-error" class="error" role="alert"></p><div class="actions"><button type="button" id="cancel-item">取消</button><button type="submit" class="primary">${item.id ? '保存修改' : '发布记录'}</button></div></form>`);
  modal.addEventListener('close', () => {
    for (const id of uploaded) if (id !== retainedImage) api.api(`/api/images/${id}`, 'DELETE').catch(() => {});
  }, { once: true });
  button('cancel-item', () => modal.close());
  button('remove-image', () => { imageId = null; document.querySelector('#upload-preview').textContent = '尚未选择图片'; document.querySelector('#upload-name').textContent = ''; });
  button('upload-image', async () => {
    const btn = document.querySelector('#upload-image'); btn.disabled = true; btn.textContent = '上传中…';
    try { const image = await api.uploadImage(); if (image) { imageId = image.id; uploaded.push(image.id); document.querySelector('#upload-preview').innerHTML = `<img src="${image.dataUrl}" alt="图片预览">`; document.querySelector('#upload-name').textContent = image.name; } }
    finally { btn.disabled = false; btn.textContent = '选择并上传图片'; }
  });
  document.querySelector('#item-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.target, submit = form.querySelector('[type=submit]'); submit.disabled = true;
    const body = Object.fromEntries(new FormData(form));
    body.title = body.title.trim(); body.image_id = imageId;
    try { await api.api(item.id ? `/api/items/${item.id}` : '/api/items', item.id ? 'PUT' : 'POST', body); retainedImage = imageId; modal.close(); notice(item.id ? '修改已保存' : '失物已发布'); await refresh(); }
    catch (error) { document.querySelector('#form-error').textContent = error.message; }
    finally { submit.disabled = false; }
  });
}
async function usersPage() {
  const content = document.querySelector('#content'); content.textContent = '正在读取账号…';
  const users = await api.api('/api/users');
  content.innerHTML = `<div class="hint">申请账号只能成为编辑者。管理员批准后才能登录；停用账号会立即撤销其登录会话。</div><table class="table"><thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>申请时间</th><th>操作</th></tr></thead><tbody>${users.map(u => `<tr><td>${escape(u.username)}</td><td>${u.role === 'admin' ? '管理员' : '编辑者'}</td><td><span class="badge ${u.approval_status}">${statusLabel(u.approval_status)}</span></td><td>${timeLabel(u.created_at)}</td><td>${u.role === 'admin' ? '—' : `${u.approval_status !== 'approved' ? `<button data-user="${u.id}" data-status="approved">批准</button>` : `<button class="danger" data-user="${u.id}" data-status="disabled">停用</button>`}${u.approval_status === 'pending' ? `<button data-user="${u.id}" data-status="rejected">拒绝</button>` : ''}`}</td></tr>`).join('')}</tbody></table>`;
  content.querySelectorAll('[data-user]').forEach(btn => btn.addEventListener('click', () => action(async () => {
    if (!confirm(`确认${statusLabel(btn.dataset.status)}这个账号？`)) return;
    btn.disabled = true;
    try { await api.api(`/api/users/${btn.dataset.user}`, 'PATCH', { approval_status: btn.dataset.status }); await usersPage(); notice('账号状态已更新'); }
    finally { btn.disabled = false; }
  })));
}
async function logsPage() {
  const logs = await api.api('/api/logs');
  const labels = { 'item.create': '发布记录', 'item.update': '修改记录', 'item.delete': '删除记录', 'user.review': '审批账号' };
  document.querySelector('#content').innerHTML = `<table class="table"><thead><tr><th>时间</th><th>用户序号</th><th>操作</th><th>目标</th><th>详情</th></tr></thead><tbody>${logs.map(log => `<tr><td>${timeLabel(log.created_at)}</td><td>${log.user_id ?? '—'}</td><td>${escape(labels[log.action] || log.action)}</td><td>${escape(log.target)}</td><td>${escape(statusLabel(log.details) || '—')}</td></tr>`).join('')}</tbody></table>${!logs.length ? '<p class="muted">暂无操作日志</p>' : ''}`;
}
function passwordPage() {
  document.querySelector('#content').innerHTML = '<form id="password-form" class="password-box"><h2>修改登录密码</h2><div class="field"><label for="oldPassword">原密码</label><input type="password" id="oldPassword" name="oldPassword" autocomplete="current-password" required></div><div class="field"><label for="newPassword">新密码</label><input type="password" id="newPassword" name="password" minlength="10" maxlength="128" autocomplete="new-password" required></div><div class="field"><label for="confirmPassword">确认新密码</label><input type="password" id="confirmPassword" name="confirmPassword" autocomplete="new-password" required></div><p class="muted">修改后会注销所有设备的登录状态。</p><button type="submit" class="primary">保存新密码</button></form>';
  document.querySelector('#password-form').addEventListener('submit', event => {
    event.preventDefault(); action(async () => {
      const form = event.target;
      if (form.password.value !== form.confirmPassword.value) throw new Error('两次密码不一致');
      const btn = form.querySelector('button'); btn.disabled = true;
      try { await api.api('/api/auth/password', 'POST', { oldPassword: form.oldPassword.value, password: form.password.value }); user = null; page = 'items'; renderShell(); notice('密码已修改，请重新登录'); }
      finally { btn.disabled = false; }
    });
  });
}
function settingsForm() {
  openModal(`${dialogHead('连接与设置')}<form id="settings-form"><div class="field"><label for="serverUrl">服务器 IP / 地址</label><input id="serverUrl" name="serverUrl" required value="${escape(settings.serverUrl)}" placeholder="192.168.1.10:8787"><div class="caption">包含端口。云端服务可填写 https://域名</div></div><div class="form-grid"><div class="field"><label for="refreshSeconds">自动刷新间隔（秒）</label><input type="number" id="refreshSeconds" name="refreshSeconds" min="15" max="3600" value="${settings.refreshSeconds}" required></div><div class="field"><label for="cacheMB">图片缓存上限（MB）</label><input type="number" id="cacheMB" name="cacheMB" min="10" max="1024" value="${settings.cacheMB}" required></div></div>${[['autoStart', '开机自动启动编辑工作台'], ['showClaimed', '默认显示已认领物品'], ['closeToTray', '关闭窗口时最小化到系统托盘']].map(([key, label]) => `<div class="field"><label class="check"><input type="checkbox" name="${key}" ${settings[key] ? 'checked' : ''}>${label}</label></div>`).join('')}<div class="hint">断网时可查看已缓存的完整记录和图片。修改服务器地址会切换到该服务器的独立缓存，并退出登录。</div><p id="settings-error" class="error"></p><div class="actions"><button type="button" id="clear-cache" class="danger">清理当前缓存</button><button type="submit" class="primary">保存设置</button></div></form>`);
  button('clear-cache', async () => { if (!confirm('确认清理当前服务器的本地缓存？')) return; await api.clearCache(); snapshot = { items: [] }; renderCards(); notice('缓存已清理'); });
  document.querySelector('#settings-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.target, btn = form.querySelector('[type=submit]'); btn.disabled = true;
    const input = { serverUrl: form.serverUrl.value, refreshSeconds: Number(form.refreshSeconds.value), cacheMB: Number(form.cacheMB.value), alwaysOnTop: false };
    for (const key of ['autoStart', 'showClaimed', 'closeToTray']) input[key] = form[key].checked;
    try { settings = await api.saveSettings(input); modal.close(); notice('设置已保存'); }
    catch (error) { document.querySelector('#settings-error').textContent = error.message; }
    finally { btn.disabled = false; }
  });
}
function scheduleRefresh() { clearInterval(timer); timer = setInterval(() => { if (!editing && page === 'items' && (!isEditor || user)) action(refresh); }, settings.refreshSeconds * 1000); }
async function initialize() {
  settings = await api.settings(); user = await api.user(); filter = settings.showClaimed ? 'all' : 'found';
  renderShell();
  try { snapshot = await api.records(false); renderCards(); } catch {}
  if (!isEditor || user) await refresh();
  scheduleRefresh();
  api.onSettingsChanged(async () => {
    settings = await api.settings(); user = await api.user(); snapshot = { items: [] }; filter = settings.showClaimed ? 'all' : 'found';
    renderShell(); scheduleRefresh(); if (!isEditor || user) await refresh();
  });
}
initialize().catch(error => { app.textContent = '无法初始化桌面端'; notice(error.message); });
