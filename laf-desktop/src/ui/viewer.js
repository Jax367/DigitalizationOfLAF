const api = window.laf;
const app = document.querySelector('#app'), modal = document.querySelector('#modal');
let settings, snapshot = { items: [] }, timer, loading = false, search = '', selected = null, detailToken = 0;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const timeLabel = value => value ? new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toLocaleString('zh-CN') : '未填写';
let noticeTimer,resizeAbort;
function updateSelection(){document.querySelectorAll('.record[data-id]').forEach(node=>{const active=Number(node.dataset.id)===selected;node.classList.toggle('active',active);node.setAttribute('aria-expanded',String(active));});}
function notice(text) { const node = document.querySelector('#notice'); node.textContent = text; node.hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => node.hidden = true, 6000); }
async function action(fn) { try { return await fn(); } catch (error) { notice(error.message); } }
function button(id, fn) { document.getElementById(id)?.addEventListener('click', () => action(fn)); }
function applyAppearance(value) {
  document.documentElement.dataset.theme = value.theme === 'dark' ? 'dark' : 'light';
  const alpha = 1 - Math.max(0, Math.min(100, value.transparency ?? 22)) / 100;
  document.documentElement.style.setProperty('--panel-alpha', String(alpha));
  document.documentElement.style.setProperty('--surface-alpha', String(alpha * 0.48));
}
modal.addEventListener('close', () => { if (settings) applyAppearance(settings); });
function renderShell() {
  applyAppearance(settings);
  app.innerHTML = `<div class="widget-layout"><section class="widget"><header class="widget-header row between"><h1><button id="reader-open" type="button" aria-label="双击打开独立浏览窗口" title="双击打开独立浏览窗口">失物招领</button> <span class="muted">· 未认领</span></h1><div class="window-actions"><button id="settings-open" aria-label="设置" title="设置及本地记录保存目录">设置</button><button id="minimize" aria-label="最小化">−</button><button id="close-window" aria-label="关闭">×</button></div></header><div class="widget-tools"><input id="search" placeholder="搜索名称、描述或楼层" aria-label="搜索失物"><button id="refresh" aria-label="刷新">↻</button></div><div class="summary"><span id="count"></span><span id="sync"></span></div><main id="cards" class="record-list"></main><footer class="widget-footer"><div class="row between"><span id="cache-time">记录保存在本地，可离线查看</span><button id="storage-open" type="button">设置</button></div><div id="storage-path" class="storage-path">正在读取保存位置…</div></footer></section></div>`;
  document.querySelector('#reader-open').addEventListener('dblclick',()=>{if(settings.experimentalReaderWindow)action(()=>api.openReaderWindow());});
  document.querySelector('#reader-open').addEventListener('keydown',event=>{if(settings.experimentalReaderWindow&&['Enter',' '].includes(event.key)){event.preventDefault();action(()=>api.openReaderWindow());}});
  button('settings-open', settingsForm); button('storage-open', settingsForm); button('refresh', refresh);
  api.cacheLocation().then(location => { const node=document.querySelector('#storage-path'); if(node){node.textContent=location.directory;node.title=location.recordsFile;} }).catch(error=>notice(error.message));
  button('minimize', () => api.windowControl('minimize')); button('close-window', () => api.windowControl('close'));
  document.querySelector('#search').value = search;
  document.querySelector('#search').addEventListener('input', event => { search = event.target.value; renderCards(); });
  renderCards();
  installResizeHandles();

}
function installResizeHandles(){
  resizeAbort?.abort();resizeAbort=new AbortController();
  for(const edge of ['n','s','e','w','ne','nw','se','sw']){
    const handle=document.createElement('div');handle.className='resize-handle resize-'+edge;handle.dataset.edge=edge;handle.title='拖动调整窗口大小';app.appendChild(handle);
    let dragging=false,chain=Promise.resolve();
    const send=data=>{chain=chain.then(()=>api.resizeWindow(data)).catch(error=>notice(error.message));};
    handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();dragging=true;handle.setPointerCapture(event.pointerId);send({phase:'start',edge,x:event.screenX,y:event.screenY});});
    handle.addEventListener('pointermove',event=>{if(dragging)send({phase:'move',x:event.screenX,y:event.screenY});});
    const finish=()=>{if(!dragging)return;dragging=false;send({phase:'end'});};
    handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);
    window.addEventListener('pointerup',finish,{signal:resizeAbort.signal});window.addEventListener('blur',finish,{signal:resizeAbort.signal});
  }
}
async function refresh() {
  if (loading) return; loading = true;
  const btn = document.querySelector('#refresh'); if (btn) btn.disabled = true;
  try {
    snapshot = await api.records(true); renderCards();
    if (selected && !snapshot.items.some(item => item.id === selected && item.status === 'found')) await closeDetails();
    else if (selected) await detail(selected);
  } catch (error) { notice(error.message); if (!snapshot.items.length) { snapshot.error = error.message; renderCards(); } }
  finally { loading = false; if (btn) btn.disabled = false; }
}
function renderCards() {
  const container = document.querySelector('#cards'); if (!container) return;
  const query = search.trim().toLowerCase();
  const items = snapshot.items.filter(item => item.status === 'found' && `${item.title} ${item.description ?? ''} ${item.floor ?? ''}`.toLowerCase().includes(query));
  document.querySelector('#count').textContent = `${items.length} 件未认领物品`;
  document.querySelector('#sync').textContent = snapshot.offline ? '离线 · 本地记录' : snapshot.syncedAt ? '已同步' : '等待同步';
  if (snapshot.syncedAt) document.querySelector('#cache-time').textContent = `本地记录更新：${timeLabel(snapshot.syncedAt)}`;
  container.innerHTML = items.length ? items.map(item => `<button class="record ${item.id === selected ? 'active' : ''}" data-id="${Number(item.id)}" aria-expanded="${item.id === selected}"><strong>${escape(item.title)}</strong></button>`).join('') : `<div class="empty"><h3>${snapshot.error && !snapshot.syncedAt ? '暂时无法获取记录' : query ? '没有匹配的物品' : '暂无未认领物品'}</h3><p>${escape(snapshot.error || '新记录同步后会显示在这里')}</p></div>`;
  container.querySelectorAll('[data-id]').forEach(node => node.addEventListener('click', () => action(() => Number(node.dataset.id) === selected ? closeDetails() : detail(Number(node.dataset.id)))));
}
async function detail(id){const token=++detailToken;selected=id;updateSelection();try{await api.openDetail(id);}catch(error){if(token===detailToken){selected=null;updateSelection();}throw error;}}
async function closeDetails(){++detailToken;selected=null;updateSelection();await api.closeDetail();}
function deviceStatus(device){
 const status={unregistered:'尚未申请',pending:'等待管理员批准',approved:'已批准',rejected:'申请已拒绝',revoked:'授权已撤销',credential_invalid:'本机凭据不可用，请重新申请'}[device.status] || device.status;
 return status+(device.group_name?' · '+device.group_name:'')+(device.username?' · '+device.username:'')+(device.status==='approved'&&(!device.account_enabled||!device.group_enabled)?' · 账号或组已停用':'');
}
async function settingsForm() {
  const cacheLocation = await api.cacheLocation();
  const device=await api.deviceInfo();
  modal.innerHTML = `<div class="dialog-head"><h2>只读客户端设置</h2><button class="quiet" id="modal-close" aria-label="关闭">×</button></div><form id="settings-form"><div class="field"><label for="windowPlacement">窗口显示方式</label><select id="windowPlacement" name="windowPlacement"><option value="desktop" ${settings.windowPlacement !== "top" ? "selected" : ""}>保持在桌面</option><option value="top" ${settings.windowPlacement === "top" ? "selected" : ""}>始终置顶</option></select><div class="caption">桌面模式允许其他软件覆盖小窗，返回桌面时显示；主动最小化或关闭后可从托盘恢复。</div></div><div class="field"><label for="detailSide">详情展开位置</label><select id="detailSide" name="detailSide"><option value="right" ${settings.detailSide !== "left" ? "selected" : ""}>右侧</option><option value="left" ${settings.detailSide === "left" ? "selected" : ""}>左侧</option></select><div class="caption">详情在独立侧窗显示，拖动详情外侧边缘调整宽度；侧边空间不足时自动换侧。</div></div><div class="field"><label for="theme">主题</label><select id="theme" name="theme"><option value="light" ${settings.theme !== "dark" ? "selected" : ""}>白色系</option><option value="dark" ${settings.theme === "dark" ? "selected" : ""}>黑色系</option></select></div><div class="field"><label for="transparency">背景透明度 <output id="transparency-value">${settings.transparency ?? 22}%</output></label><input id="transparency" name="transparency" type="range" min="0" max="100" step="1" value="${settings.transparency ?? 22}"><div class="caption">0% 不透明，100% 背景完全透明；文字及图片保持清晰。修改时实时预览，保存后生效。</div></div><div class="field"><label for="serverUrl">服务器 IP / 地址</label><input id="serverUrl" name="serverUrl" required value="${escape(settings.serverUrl)}"></div><div class="field"><label for="cacheDirectory">本地记录保存目录</label><div class="directory-picker"><input id="cacheDirectory" name="cacheDirectory" value="${escape(settings.cacheDirectory)}" placeholder="填写绝对路径，或点击浏览"><button type="button" id="choose-directory">浏览…</button></div><button type="button" id="default-directory" class="quiet">恢复默认目录</button><div class="caption current-directory">当前记录文件：${escape(cacheLocation.recordsFile)}</div></div><div class="field"><label for="refreshSeconds">刷新间隔（秒）</label><input type="number" id="refreshSeconds" name="refreshSeconds" min="15" max="3600" value="${settings.refreshSeconds}" required></div><div class="field"><label for="cacheMB">图片保存上限（MB）</label><input type="number" id="cacheMB" name="cacheMB" min="10" max="1024" value="${settings.cacheMB}" required></div>${[['autoStart','开机自动启动'],['closeToTray','关闭时收至托盘']].map(([key,label]) => `<div class="field"><label class="check"><input type="checkbox" name="${key}" ${settings[key] ? 'checked' : ''}>${label}</label></div>`).join('')}<div class="hint">记录保存在所选目录的 laf-cache 子目录，按服务器隔离。仅显示未认领物品；已认领的本地记录保留一周后清理。</div><details class="device-settings"><summary>试验功能</summary><label class="check"><input type="checkbox" name="experimentalReaderWindow" ${settings.experimentalReaderWindow ? "checked" : ""}>双击标题打开独立浏览窗口</label><button type="button" id="reader-open-settings">打开独立窗口</button></details><p id="settings-error" class="error"></p><div class="actions"><button type="button" id="clear-cache" class="danger">清理本地记录</button><button type="submit" class="primary">保存</button></div></form><details class="device-settings"><summary>设备管理</summary><p id="device-state" class="hint">${escape(deviceStatus(device))}</p><button type="button" id="device-refresh">检查审批状态</button><form id="device-apply-form"><div class="field"><label>设备显示名称<input name="display_name" required maxlength="80" value="${escape(device.display_name)}"></label></div><div class="field"><label>只读管理账号<input name="username" required maxlength="40" value="${escape(device.username || '')}" autocomplete="username"></label></div><div class="field"><label>账号密码<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="current-password"></label></div><p class="caption">当前服务器：${escape(settings.serverUrl)}<br>请先在上方保存服务器地址。账号由管理员创建；重复申请会重新等待审批，密码不会保存到本地。</p><p id="device-error" class="error"></p><button type="submit" >发送加入申请</button></form></details>`;
  modal.showModal();
  button('reader-open-settings',()=>api.openReaderWindow());
  const updateDeviceStatus=info=>{document.querySelector('#device-state').textContent=deviceStatus(info);};
  button('device-refresh',async()=>{try{const info=await api.refreshDevice();updateDeviceStatus(info);await refresh();}catch(error){document.querySelector('#device-error').textContent=error.message;}});
  document.querySelector('#device-apply-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.target,btn=form.querySelector('button');btn.disabled=true;try{const info=await api.applyDevice({display_name:form.display_name.value,username:form.username.value,password:form.password.value});form.password.value='';updateDeviceStatus(info);document.querySelector('#device-error').textContent='';await refresh();}catch(error){document.querySelector('#device-error').textContent=error.message;}finally{btn.disabled=false;}});
  button('modal-close', () => { modal.close(); applyAppearance(settings); });
  const preview = () => {
    const transparency = Number(document.querySelector('#transparency').value);
    document.querySelector('#transparency-value').textContent = transparency + '%';
    applyAppearance({ theme: document.querySelector('#theme').value, transparency });
  };
  document.querySelector('#theme').addEventListener('change', preview);
  document.querySelector('#transparency').addEventListener('input', preview);
  button('choose-directory', async () => { const dir = await api.chooseCacheDirectory(); if (dir) document.querySelector('#cacheDirectory').value = dir; });
  button('default-directory', () => { document.querySelector('#cacheDirectory').value = ''; });
  button('clear-cache', async () => { if (!confirm('确认清理当前服务器的本地记录与图片？')) return; await api.clearCache(); snapshot = {items: []}; await closeDetails(); notice('本地记录已清理'); });
  document.querySelector('#settings-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.target, btn = form.querySelector('[type=submit]'); btn.disabled = true;
    const input = {windowPlacement:form.windowPlacement.value,alwaysOnTop:form.windowPlacement.value==='top',serverUrl:form.serverUrl.value, cacheDirectory:form.cacheDirectory.value, refreshSeconds:Number(form.refreshSeconds.value),cacheMB:Number(form.cacheMB.value),showClaimed:false,detailSide:form.detailSide.value,theme:form.theme.value,transparency:Number(form.transparency.value)};
    for (const key of ['autoStart','closeToTray','experimentalReaderWindow']) input[key] = form[key].checked;
    try { settings = await api.saveSettings(input); modal.close(); notice('设置已保存'); } catch(error) {document.querySelector('#settings-error').textContent=error.message;} finally{btn.disabled=false;}
  });
}
function schedule(){clearInterval(timer);timer=setInterval(()=>action(refresh),settings.refreshSeconds*1000);}
async function initialize(){
  settings=await api.settings();renderShell();try{snapshot=await api.records(false);renderCards();}catch{}
  api.onDetailClosed(()=>{++detailToken;selected=null;updateSelection();});
  await refresh();schedule();
  api.onSettingsChanged(async()=>{++detailToken;selected=null;await api.closeDetail();settings=await api.settings();snapshot={items:[]};renderShell();schedule();await refresh();});
}
initialize().catch(error=>{app.textContent='无法初始化只读客户端';notice(error.message);});
