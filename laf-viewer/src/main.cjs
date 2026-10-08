const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const storage = require('./storage.cjs');
const network = require('./network.cjs');
const { trayIcon } = require('./tray-icon.cjs');
const client = require('./client-config.cjs');
const isEditor = client.role === 'editor';
let settings = { ...storage.defaults, ...(isEditor ? { alwaysOnTop: false, showClaimed: true, closeToTray: false } : {}) };
const initialSettings = { ...settings };
let mainWindow, tray, quitting = false, session = null, syncPromise;
let desktopLayer,readerWindow,sideDetail;
let resizeState=null;
app.setName(client.name);
app.setPath('userData', process.env.LAF_TEST_PROFILE ? path.resolve(process.env.LAF_TEST_PROFILE) : path.join(app.getPath('appData'), client.profile));
if (process.env.LAF_TEST_PROFILE) app.setPath('sessionData', path.resolve(process.env.LAF_TEST_PROFILE));
if (process.platform === 'win32') app.setAppUserModelId(client.appId);
const root = () => app.getPath('userData');
const deviceClient=require('./device-client.cjs')({root,origin:()=>settings.serverUrl});
const directory = () => storage.cacheDirectory(!isEditor && settings.cacheDirectory ? settings.cacheDirectory : root(), settings.serverUrl);
function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); desktopLayer?.hidden(false); mainWindow.show(); mainWindow.focus(); return mainWindow; }
  const area = screen.getPrimaryDisplay().workArea;
  const small = !isEditor;
  mainWindow = new BrowserWindow({
    width: small ? Math.min(settings.windowWidth,area.width) : 1100, height: small ? Math.min(settings.windowHeight,area.height) : 800,
    minWidth: small ? 340 : 800, minHeight: small ? 360 : 480,
    ...(small ? { x: area.x + Math.max(0, area.width - settings.windowWidth - 10), y: area.y + Math.min(30, Math.max(0,area.height-settings.windowHeight)) } : {}),
    skipTaskbar: small,
    title: client.name, autoHideMenuBar: true, alwaysOnTop: small && settings.alwaysOnTop,
    backgroundColor: small ? '#00000000' : '#f4f6fa', transparent: small, frame: !small, resizable: !small,
    show: !process.env.LAF_TEST_PROFILE,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !process.env.LAF_TEST_PROFILE },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('move',()=>sideDetail?.align());mainWindow.on('resize',()=>sideDetail?.align());
  mainWindow.on('hide',()=>sideDetail?.close(false));
  mainWindow.on('closed',()=>{sideDetail?.destroy();if(!quitting&&!settings.closeToTray)app.quit();});
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, 'ui/index.html'));
  if(small){desktopLayer=require('./desktop-layer.cjs')(mainWindow);desktopLayer.update(!settings.alwaysOnTop);}
  mainWindow.on('close', event => { if (!quitting && settings.closeToTray) { event.preventDefault(); desktopLayer?.hidden(true); sideDetail?.close(false);mainWindow.hide(); } });
  return mainWindow;
}
function openReaderWindow(){
 if(readerWindow&&!readerWindow.isDestroyed()){if(readerWindow.isMinimized())readerWindow.restore();readerWindow.show();readerWindow.focus();return true;}
 readerWindow=new BrowserWindow({width:1000,height:720,minWidth:700,minHeight:480,title:'失物招领 · 独立浏览（试验）',autoHideMenuBar:true,backgroundColor:'#f4f6fa',webPreferences:{preload:path.join(__dirname,'preload-reader.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 readerWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));readerWindow.webContents.on('will-navigate',event=>event.preventDefault());readerWindow.on('closed',()=>{readerWindow=null;});readerWindow.loadFile(path.join(__dirname,'ui/reader.html'));return true;
}
function applySettings() {
  sideDetail?.update();
  desktopLayer?.update(!settings.alwaysOnTop);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(!isEditor && settings.alwaysOnTop);
  if (process.platform === 'win32' && !process.env.LAF_TEST_PROFILE) app.setLoginItemSettings({
    name: client.profile, openAtLogin: settings.autoStart, path: process.execPath,
    args: app.isPackaged ? ['--autostart'] : [app.getAppPath(), '--autostart'],
  });
}
async function request(route, options = {}, raw = false) {

  const target=new URL(route,settings.serverUrl);
  if(!isEditor){
    const params=target.searchParams,keys=[...params.keys()];
    const list=target.pathname==='/api/items'&&keys.every(key=>['status','limit','before','snapshot'].includes(key))&&(!params.has('status')||params.get('status')==='found');
    const single=/^\/api\/items\/[1-9]\d*$/.test(target.pathname)&&!target.search;
    const status=target.pathname==='/api/items/cache-status'&&keys.length===1&&/^\d+(?:,\d+)*$/.test(params.get('ids')??'');
    if(target.origin!==settings.serverUrl||options.method&&options.method!=='GET'||!list&&!single&&!status)throw new Error('只读客户端不支持此操作');
    if(list&&!raw){
      const query=new URLSearchParams(params);query.set('limit','100');let items=[],bytes=0,last=Infinity;
      for(let page=0;page<100;page++){
        const payload=await request('/api/items?'+query.toString(),options,true);
        if(!Array.isArray(payload.data))throw new Error('服务器分页格式错误');
        items.push(...payload.data);bytes+=Buffer.byteLength(JSON.stringify(payload.data));if(items.length>10000||bytes>40*1024*1024)throw new Error('记录超过本地容量限制');
        const next=payload.pagination?.nextCursor;if(next==null)return items;
        if(!Number.isSafeInteger(next)||next<1||next>=last)throw new Error('服务器分页游标错误');last=next;
        query.set('before',String(next));query.set('snapshot',String(payload.pagination.snapshot));
      }throw new Error('记录页数超过允许范围');
    }
  }
  const payload = await network.json(`${settings.serverUrl}${route}`, {
    ...options,
    headers: { ...(options.body && !(options.body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...(isEditor ? session ? {Authorization: 'Bearer '+session.token} : {} : await deviceClient.headers()), ...options.headers },
  });
  return raw?payload:payload.data;
}
async function fetchImage(route) {
  return network.withResponse(`${settings.serverUrl}${route}`, { headers:isEditor?session?{Authorization:'Bearer '+session.token}:{}:await deviceClient.headers() }, async response => {
  const type = response.headers.get('content-type')?.split(';')[0];
  if (!response.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(type)) throw new Error('图片下载失败');
  let size = 0; const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; if (size > 5 * 1024 * 1024) throw new Error('图片过大'); chunks.push(chunk); }
  return { size, dataUrl: `data:${type};base64,${Buffer.concat(chunks).toString('base64')}` };
  });
}
async function records(refresh) {
  if(!isEditor){
    if(refresh){try{await deviceClient.refresh();}catch(error){if(error.status===401||error.status===403){sideDetail?.close(false);return {items:[],offline:false,error:error.message};}}}
    if(!await deviceClient.authorized()){sideDetail?.close(false);return {items:[],offline:false,error:'请在设置中申请设备授权，等待管理员批准'};}
  }
  const dir = directory();
  const saved = isEditor ? await storage.readJson(path.join(dir, 'records.json'), null) : await storage.pruneRetired(dir);
  if (!refresh && saved) return { ...saved, offline: false, cached: true };
  if (!syncPromise) syncPromise = (isEditor ? storage.syncCache : storage.syncReadOnlyCache)(dir, { ...settings }, route => request(route), fetchImage).finally(() => { syncPromise = null; });
  try { return await syncPromise; }
  catch (error) { if(!isEditor&&(error.status===401||error.status===403)){await deviceClient.block();sideDetail?.close(false);return {items:[],offline:false,error:'设备授权已失效，请在设置中查看'};}if (!saved) throw new Error(`连接失败，尚无本地缓存。${error.message}`); return { ...saved, offline: true, error: error.message }; }
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    const source=BrowserWindow.fromWebContents(event.sender);
    const reader=readerWindow&&source===readerWindow&&['settings:get','records:list','records:image'].includes(channel);
    const detail=sideDetail?.window()&&source===sideDetail.window()&&['detail:state','detail:ready','detail:close','detail:width','records:image'].includes(channel);
    if(source!==mainWindow&&!reader&&!detail)throw new Error('无效窗口');
    try { return { ok: true, value: await fn(...args) }; } catch (error) { return { ok: false, error: error.message }; }
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => createWindow());
  app.whenReady().then(async () => {
    try { settings = storage.normalizeSettings({ ...initialSettings, ...await storage.readJson(path.join(root(), 'settings.json'), {}) }); } catch { settings = { ...initialSettings }; }
    sideDetail=require('./side-detail.cjs')({main:()=>mainWindow,settings:()=>settings,read:()=>records(false),layer:()=>desktopLayer,onClose:()=>mainWindow?.webContents.send('detail:closed'),saveWidth:async width=>{settings={...settings,detailWidth:width};await storage.writeJson(path.join(root(),'settings.json'),settings);}});
    handle('detail:open',id=>sideDetail.open(id));handle('detail:close',()=>sideDetail.close());handle('detail:state',()=>sideDetail.state());handle('detail:ready',revision=>sideDetail.ready(revision));handle('detail:width',width=>sideDetail.resize(width));
    applySettings();
    tray = new Tray(nativeImage.createFromBuffer(trayIcon(isEditor)));
    tray.setToolTip(client.name);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: isEditor ? '显示编辑工作台' : '显示失物小窗', click: createWindow },
      { type: 'separator' }, { label: '退出', click: () => app.quit() },
    ]));
    tray.on('double-click', createWindow);
    handle('reader:open',()=>{if(!settings.experimentalReaderWindow)throw new Error('试验功能已关闭');return openReaderWindow();});
    handle('settings:get', () => settings);
    handle('settings:save', async input => {
      const next = storage.normalizeSettings({...input,detailWidth:settings.detailWidth,windowWidth:settings.windowWidth,windowHeight:settings.windowHeight});
      if ((next.serverUrl !== settings.serverUrl || next.cacheDirectory !== settings.cacheDirectory) && syncPromise) throw new Error('正在同步，请完成后修改服务器或保存目录');
      if (!isEditor) {
        next.showClaimed = false;
        const target = storage.cacheDirectory(next.cacheDirectory || root(), next.serverUrl);
        await fs.mkdir(target, { recursive: true });
        if (next.serverUrl === settings.serverUrl && target !== directory()) {
          // Copy only this application's scoped cache, preserving the old copy on directory changes.
          await fs.cp(directory(), target, { recursive: true }).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
      }
      await storage.writeJson(path.join(root(), 'settings.json'), next);
      if (next.serverUrl !== settings.serverUrl) session = null;
      sideDetail?.close(false);settings = next; applySettings(); mainWindow?.webContents.send('settings:changed');readerWindow?.webContents.send('settings:changed'); return settings;
    });
    handle('records:list', refresh => records(Boolean(refresh)));
    handle('records:image', async id => !isEditor&&!await deviceClient.authorized()?null:storage.imageData(directory(), id));
    handle('cache:clear', async () => { if (syncPromise) throw new Error('同步中，请稍后清理'); await fs.rm(directory(), { recursive: true, force: true }); return true; });
    if (!isEditor) {
      handle('device:info',()=>deviceClient.info());
      handle('device:refresh',()=>deviceClient.refresh());
      handle('device:apply',input=>deviceClient.apply(input));
      handle('cache:location', () => ({ directory: directory(), recordsFile: path.join(directory(), 'records.json') }));
      handle('cache:choose-directory', async () => {
        const result = await dialog.showOpenDialog(mainWindow, { title: '选择本地记录保存目录', properties: ['openDirectory', 'createDirectory'] });
        return result.canceled ? null : result.filePaths[0];
      });
      handle('window:controls', command => { if (command === 'minimize') {desktopLayer?.hidden(true);sideDetail?.close(false);mainWindow.minimize();} else if (command === 'close') mainWindow.close(); else throw new Error('无效操作'); });
      handle('window:resize', async data => {
        if(!data || !['start','move','end'].includes(data.phase))throw new Error('无效缩放操作');
        if(data.phase==='start'){
          if(!['n','s','e','w','ne','nw','se','sw'].includes(data.edge)||!Number.isFinite(data.x)||!Number.isFinite(data.y))throw new Error('无效缩放边缘');
          resizeState={edge:data.edge,x:data.x,y:data.y,bounds:mainWindow.getBounds()};return true;
        }
        if(!resizeState)return true;
        if(data.phase==='move'){
          if(!Number.isFinite(data.x)||!Number.isFinite(data.y))throw new Error('无效坐标');
          const {edge,x,y,bounds}=resizeState,dx=data.x-x,dy=data.y-y;
          const area=screen.getDisplayMatching(bounds).workArea;
          const minWidth=340;
          let width=bounds.width+(edge.includes('e')?dx:edge.includes('w')?-dx:0),height=bounds.height+(edge.includes('s')?dy:edge.includes('n')?-dy:0);
          width=Math.round(Math.max(minWidth,Math.min(area.width,2400,width)));height=Math.round(Math.max(360,Math.min(area.height,1800,height)));
          let left=edge.includes('w')?bounds.x+bounds.width-width:bounds.x,top=edge.includes('n')?bounds.y+bounds.height-height:bounds.y;
          left=Math.max(area.x,Math.min(left,area.x+area.width-width));top=Math.max(area.y,Math.min(top,area.y+area.height-height));
          mainWindow.setBounds({x:left,y:top,width,height});return true;
        }
        resizeState=null;
        const bounds=mainWindow.getBounds();
        settings={...settings,windowWidth:bounds.width,windowHeight:bounds.height};
        await storage.writeJson(path.join(root(),'settings.json'),settings);return true;
      });

    }
    if (isEditor) require('./editor-handlers.cjs')({
      handle, request, directory, window: () => mainWindow, waitForSync: () => syncPromise?.catch(() => {}),
      getSession: () => session, setSession: value => { session = value; },
    });
    createWindow();
  }).catch(error => { dialog.showErrorBox('启动失败', error.message); app.quit(); });
}
app.on('before-quit', () => { quitting = true;readerWindow?.destroy();sideDetail?.destroy(); desktopLayer?.stop(); });
app.on('window-all-closed', () => { if (!settings.closeToTray) app.quit(); });
app.on('activate', createWindow);
