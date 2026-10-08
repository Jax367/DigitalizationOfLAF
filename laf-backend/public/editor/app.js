/* Browser UI uses same-origin API and HttpOnly session cookies. */
const api = {
  async request(route, method = 'GET', body, full=false) {
    const response = await fetch(route, {method, credentials:'same-origin', cache:'no-store', headers: body instanceof File ? {'Content-Type':body.type || 'application/octet-stream'} : body ? {'Content-Type':'application/json'} : {}, ...(body ? {body:body instanceof File ? body : JSON.stringify(body)} : {})});
    const result=await response.json();
    if(!response.ok || !result.success){
      const error=new Error(result.error || '请求失败');error.status=response.status;
      if(response.status===401 && user){ user=null;page='items';if(modal.open)modal.close();renderShell(); }
      throw error;
    }
    return full?result:result.data;
  },
  settings:async()=>({showClaimed:true,refreshSeconds:60,serverUrl:location.origin}),
  user:async()=>{try{return await api.request('/api/auth/me');}catch(error){if(error.status===401)return null;throw error;}},
  login:async body=>(await api.request('/api/auth/login','POST',body)).user,
  register:body=>api.request('/api/auth/register','POST',body),
  logout:()=>api.request('/api/auth/logout','POST'),
  api:async(route,method='GET',body)=>{
    if(method==='GET'&&['/api/users','/api/access-groups','/api/reader-accounts','/api/devices'].includes(route)){
      const query=new URLSearchParams({limit:'100'});let rows=[],last=Infinity;
      for(let page=0;page<100;page++){const result=await api.request(route+'?'+query.toString(),'GET',undefined,true);rows.push(...result.data);const next=result.pagination?.nextCursor;if(next==null)return rows;if(!Number.isSafeInteger(next)||next>=last)throw new Error('分页响应异常');last=next;query.set('before',String(next));query.set('snapshot',String(result.pagination.snapshot));}throw new Error('管理列表超过加载范围');
    }return api.request(route,method,body);
  },
  records:async()=>{const query=new URLSearchParams({limit:'50'});if(filter!=='all')query.set('status',filter);if(search.trim())query.set('q',search.trim());const result=await api.request('/api/items?'+query.toString(),'GET',undefined,true);return {items:result.data,pagination:result.pagination,syncedAt:new Date().toISOString()};},
  image:async id=>id ? '/api/images/'+id : null,
  async uploadImage(){
    const input=document.querySelector('#web-file-picker');input.value='';
    const file=await new Promise(resolve=>{input.onchange=()=>resolve(input.files[0] ?? null);input.oncancel=()=>resolve(null);input.click();});
    if(!file)return null;
    if(file.size>5*1024*1024)throw new Error('图片不能超过 5 MB');
    const image=await api.request('/api/images','POST',file);
    return {...image,dataUrl:image.url,name:file.name};
  },
  onSettingsChanged:()=>{},
};
const isEditor = true;
const canWrite = () => Boolean(user && (user.role === 'admin' || user.can_edit === 1));
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
let settings, user = null, snapshot = { items: [] }, page = 'items', authMode = 'login', timer, loading = false, editing = false;
let search = '', filter = 'found';
const pendingClaims=new Set();
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statusLabel = value => ({ found: '未认领', claimed: '已认领', pending: '待批准', approved: '已批准', rejected: '已拒绝', disabled: '已停用' }[value] ?? value);
const timeLabel = value => value ? new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toLocaleString('zh-CN') : '未填写';
let noticeTimer,searchTimer,refreshPending=false;
function notice(text) { const node = document.querySelector('#notice'); node.textContent = text; node.hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => node.hidden = true, 6500); }
async function action(fn) { try { return await fn(); } catch (error) { notice(error.message); } }
function button(id, fn) { document.getElementById(id)?.addEventListener('click', () => action(fn)); }
function openModal(html) { modal.innerHTML = html; if (!modal.open) modal.showModal(); button('modal-close', () => modal.close()); }
modal.addEventListener('close', () => { editing = false; });
function dialogHead(title) { return `<div class="dialog-head"><h2>${title}</h2><button class="quiet" id="modal-close" aria-label="关闭">✕</button></div>`; }
function renderShell() {
  const brand = `<div class="brand"><div class="brand-icon">L</div><div><h1>失物招领</h1><div class="muted">让遗失的物品，回到主人身边</div></div></div>`;
  {
    app.innerHTML = `<div class="editor-shell"><aside class="sidebar"><div class="brand"><div class="brand-icon">L</div><strong>失物招领<br><span class="muted">网页工作台</span></strong></div><button id="nav-items">失物记录</button>${user?.role === 'admin' ? '<button id="nav-users">账号审批</button><button id="nav-logs">操作日志</button><button id="nav-readers">只读设备管理</button>' : ''}<button id="nav-password">修改密码</button><button id="settings-open">服务器信息</button><div class="account">${user ? `<p>${escape(user.username)} · ${user.role === 'admin' ? '管理员' : '编辑者'}</p><button id="logout">退出登录</button>` : '<p>登录后可维护失物记录</p>'}</div></aside><section class="workspace"><header class="header"><div class="row between"><div><h1 id="page-title">失物记录</h1><span class="muted">统一管理记录、图片与认领状态</span></div><button id="new-item" class="primary" ${!canWrite() ? 'hidden' : ''}>＋ 发布失物</button></div><div class="tools" id="item-tools"><input id="search" placeholder="搜索物品名称、描述或楼层" aria-label="搜索失物"><select id="filter" aria-label="认领状态"><option value="found">未认领</option><option value="claimed">已认领</option><option value="all">全部</option></select><button id="refresh">刷新</button></div></header><main class="body" id="content"></main></section></div>`;
    button('nav-items', () => navigate('items'));
    button('nav-users', () => navigate('users'));
    button('nav-logs', () => navigate('logs'));
    button('nav-readers', () => navigate('readers')); 
    button('nav-password', () => navigate('password'));
    button('new-item', () => itemForm());
    button('logout', async () => { await api.logout(); user = null; page = 'items'; renderShell(); renderAuth(); });
  }
  button('settings-open', settingsForm);
  button('refresh', () => refresh());
  document.querySelector('#search')?.addEventListener('input', event => { search = event.target.value; clearTimeout(searchTimer);searchTimer=setTimeout(()=>action(refresh),300); });
  const filterInput = document.querySelector('#filter');
  if (filterInput) { filterInput.value = filter; filterInput.addEventListener('change', event => { filter = event.target.value; action(refresh); }); }
  if (isEditor) {
    if (!user) renderAuth(); else navigate(page);
  } else renderCards();
}
function renderAuth() {
  document.querySelector('#item-tools').hidden = true;
  document.querySelector('#content').innerHTML = `<div class="auth"><h2>${authMode === 'login' ? '登录网页工作台' : '申请编辑者账号'}</h2><p class="muted">编辑者账号经管理员批准后启用。撤销编辑权限后仍可查看记录。</p><div class="tabs"><button id="auth-login" class="${authMode === 'login' ? 'primary' : ''}">登录</button><button id="auth-register" class="${authMode === 'register' ? 'primary' : ''}">申请账号</button></div><form id="auth-form"><div class="field"><label for="username">用户名</label><input id="username" name="username" required minlength="3" maxlength="40" autocomplete="username" placeholder="3–40 个字母、数字或中文"></div><div class="field"><label for="password">密码</label><input id="password" name="password" type="password" required minlength="10" maxlength="128" autocomplete="${authMode === 'login' ? 'current-password' : 'new-password'}" placeholder="至少 10 个字符"></div>${authMode === 'register' ? '<div class="field"><label for="confirm">确认密码</label><input id="confirm" name="confirm" type="password" required autocomplete="new-password"></div>' : ''}<button type="submit" class="primary">${authMode === 'login' ? '登录' : '提交申请'}</button><p id="auth-message" class="muted caption"></p></form><div class="hint">当前服务器：${escape(settings.serverUrl)}<br>首次使用时，由服务器维护者初始化管理员账号。</div></div>`;
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
  for (const id of ['items', 'users', 'logs', 'password', 'readers']) document.querySelector(`#nav-${id}`)?.classList.toggle('active', id === next);
  document.querySelector('#page-title').textContent = ({ items: '失物记录', users: '账号审批', logs: '操作日志', password: '修改密码', readers:'只读设备管理' })[next];
  document.querySelector('#item-tools').hidden = next !== 'items';
  document.querySelector('#new-item').hidden = next !== 'items' || !canWrite();
  const content = document.querySelector('#content');
  if (next === 'items') { content.innerHTML = (!canWrite() ? '<div class="hint">编辑权限已被管理员撤销。当前只能查看记录，请联系管理员恢复权限。</div>' : '') + '<div class="summary"><span id="count"></span><span id="sync"></span></div><div id="cards" class="cards"></div><div class="actions"><button id="items-more" hidden>加载更多记录</button></div>'; renderCards();button('items-more',loadMoreRecords); }
  else if (next === 'users') await usersPage();
  else if (next === 'logs') await logsPage();
  else if (next === 'readers') await readersPage();
  else passwordPage();
}
async function refresh() {
  if (loading) {refreshPending=true;return;}
  loading = true;
  const refreshButton = document.querySelector('#refresh');
  if (refreshButton) refreshButton.disabled = true;
  try { snapshot = await api.records(true); if (page === 'items') renderCards(); }
  catch (error) { notice(error.message); if (!snapshot.items.length) { snapshot.error = error.message; renderCards(); } }
  finally { loading = false; if (refreshButton) refreshButton.disabled = false;if(refreshPending){refreshPending=false;action(refresh);} }
}
async function loadMoreRecords(){
 if(loading||!snapshot.pagination?.nextCursor)return;loading=true;const btn=document.querySelector('#items-more');btn.disabled=true;
 try{const query=new URLSearchParams({limit:'50',before:String(snapshot.pagination.nextCursor),snapshot:String(snapshot.pagination.snapshot)});if(filter!=='all')query.set('status',filter);if(search.trim())query.set('q',search.trim());const result=await api.request('/api/items?'+query.toString(),'GET',undefined,true);snapshot.items.push(...result.data);snapshot.pagination=result.pagination;renderCards();}finally{loading=false;btn.disabled=false;if(refreshPending){refreshPending=false;action(refresh);}}
}
function renderCards() {
  const container = document.querySelector('#cards');
  if (!container) return;
  const more=document.querySelector('#items-more');if(more)more.hidden=!snapshot.pagination?.nextCursor;
  const query = search.trim().toLowerCase();
  const items = snapshot.items.filter(item => (filter === 'all' || item.status === filter) && `${item.title} ${item.description ?? ''} ${item.floor ?? ''}`.toLowerCase().includes(query));
  document.querySelector('#count').textContent = `${items.length} 件物品`;
  document.querySelector('#sync').textContent = snapshot.offline ? '离线 · 显示本地缓存' : snapshot.missingImages ? `缺少 ${snapshot.missingImages} 张图片` : snapshot.syncedAt ? '已同步' : '等待同步';
  document.querySelector('#sync').classList.toggle('sync-warning', Boolean(snapshot.offline || snapshot.missingImages));
  const cacheTime = document.querySelector('#cache-time');
  if (cacheTime && snapshot.syncedAt) cacheTime.textContent = `缓存更新：${timeLabel(snapshot.syncedAt)}`;
  container.innerHTML = items.length ? items.map(item => `<article class="card"><button class="card-open" data-id="${item.id}"><div class="thumb placeholder" data-image="${escape(item.image_id)}">◇</div><div class="card-info"><div class="row between"><h3>${escape(item.title)}</h3><span class="badge ${escape(item.status)}">${statusLabel(item.status)}</span></div><p class="excerpt">${escape(item.description || '暂无物品描述')}</p><div class="muted">#${item.id} · ${escape(item.floor || '楼层未填写')}</div></div></button><label class="claim-check"><input type="checkbox" data-claim="${item.id}" aria-label="${escape(item.title)}已认领" ${item.status === "claimed" ? "checked" : ""} ${!canWrite() || pendingClaims.has(item.id) ? "disabled" : ""}>已认领<span class="caption">${pendingClaims.has(item.id) ? "正在保存…" : "勾选即完成认领"}</span></label></article>`).join('') : `<div class="empty"><h3>${snapshot.error && !snapshot.syncedAt ? '暂时无法获取记录' : query ? '没有匹配的物品' : '暂无失物记录'}</h3><p>${escape(snapshot.error || '新记录同步后会显示在这里')}</p>${isEditor && canWrite() ? '<button id="empty-create" class="primary">发布第一件失物</button>' : ''}</div>`;
  container.querySelectorAll('[data-claim]').forEach(node=>node.addEventListener('change',()=>action(()=>toggleClaim(Number(node.dataset.claim),node.checked))));
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
async function toggleClaim(id,checked){
 if(!canWrite() || pendingClaims.has(id))return;
 pendingClaims.add(id);const control=document.querySelector('[data-claim="'+id+'"]');if(control)control.disabled=true;
 try{
  const updated=await api.api('/api/items/'+id,'PUT',{status:checked?'claimed':'found'});
  snapshot.items=snapshot.items.map(item=>item.id===id?updated:item);
  notice(checked?'已标记为已认领，可在已认领或全部列表取消勾选恢复':'已恢复为未认领');
 }finally{pendingClaims.delete(id);if(page==='items')renderCards();}
}
async function detail(id) {
  const item = snapshot.items.find(i => i.id === id);
  if (!item) return;
  const photo = await api.image(item.image_id);
  openModal(`${dialogHead(escape(item.title))}${photo ? `<img class="photo" src="${photo}" alt="${escape(item.title)}">` : '<div class="hint">暂无图片或图片尚未缓存</div>'}<span class="badge ${item.status}">${statusLabel(item.status)}</span><p class="description">${escape(item.description || '暂无描述')}</p><dl class="facts"><dt>序号</dt><dd>#${item.id}</dd><dt>出现楼层</dt><dd>${escape(item.floor || "未填写")}</dd><dt>录入时间</dt><dd>${timeLabel(item.created_at)}</dd></dl>${isEditor && canWrite() ? '<div class="actions"><button id="delete-item" class="danger">删除记录</button><button id="edit-item" class="primary">编辑记录</button></div>' : ''}`);
  button('edit-item', () => itemForm(item));
  button('delete-item', async () => {
    if (!confirm(`确认删除「${item.title}」？此操作无法撤销。`)) return;
    await api.api(`/api/items/${id}`, 'DELETE'); modal.close(); notice('记录已删除'); await refresh();
  });
}
async function itemForm(item = {}) {
  if(!canWrite())throw new Error("没有编辑权限");
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
    catch (error) { const node=document.querySelector('#form-error');if(node)node.textContent=error.message;else notice(error.message); }
    finally { submit.disabled = false; }
  });
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
function settingsForm(){openModal(dialogHead('服务器连接')+'<p class="muted">当前服务：'+escape(location.origin)+'</p><p>网页端直接连接提供本页面的服务器。</p>');}
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
