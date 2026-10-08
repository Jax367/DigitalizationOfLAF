const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const storage = require('./storage.cjs');
const { trayIcon } = require('./tray-icon.cjs');
const client = require('./client-config.cjs');
const isEditor = client.role === 'editor';
let settings = { ...storage.defaults, ...(isEditor ? { alwaysOnTop: false, showClaimed: true, closeToTray: false } : {}) };
const initialSettings = { ...settings };
let mainWindow, tray, quitting = false, session = null, syncPromise;
app.setName(client.name);
app.setPath('userData', process.env.LAF_TEST_PROFILE ? path.resolve(process.env.LAF_TEST_PROFILE) : path.join(app.getPath('appData'), client.profile));
if (process.env.LAF_TEST_PROFILE) app.setPath('sessionData', path.resolve(process.env.LAF_TEST_PROFILE));
if (process.platform === 'win32') app.setAppUserModelId(client.appId);
const root = () => app.getPath('userData');
const directory = () => storage.cacheDirectory(!isEditor && settings.cacheDirectory ? settings.cacheDirectory : root(), settings.serverUrl);
function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); return mainWindow; }
  const area = screen.getPrimaryDisplay().workArea;
  const small = !isEditor;
  mainWindow = new BrowserWindow({
    width: small ? 420 : 1100, height: small ? 650 : 800,
    minWidth: small ? 420 : 800, minHeight: 480,
    ...(small ? { x: area.x + Math.max(0, area.width - 430), y: area.y + 30 } : {}),
    title: client.name, autoHideMenuBar: true, alwaysOnTop: small && settings.alwaysOnTop,
    backgroundColor: small ? '#00000000' : '#f4f6fa', transparent: small, frame: !small, resizable: !small,
    show: !process.env.LAF_TEST_PROFILE,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !process.env.LAF_TEST_PROFILE },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, 'ui/index.html'));
  mainWindow.on('close', event => { if (!quitting && settings.closeToTray) { event.preventDefault(); mainWindow.hide(); } });
  return mainWindow;
}
function applySettings() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(!isEditor && settings.alwaysOnTop);
  if (process.platform === 'win32' && !process.env.LAF_TEST_PROFILE) app.setLoginItemSettings({
    name: client.profile, openAtLogin: settings.autoStart, path: process.execPath,
    args: app.isPackaged ? ['--autostart'] : [app.getAppPath(), '--autostart'],
  });
}
async function request(route, options = {}) {
  // The read-only application can only perform public GETs, even inside the main process.
  if (!isEditor && ((options.method && options.method !== 'GET') || !/^\/api\/items(?:\/[1-9]\d*)?(?:\?status=found)?$/.test(route) && !/^\/api\/items\/cache-status\?ids=[\d,]+$/.test(route))) throw new Error('只读客户端不支持写入或账号操作');
  const response = await fetch(`${settings.serverUrl}${route}`, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { ...(options.body && !(options.body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Authorization: `Bearer ${session.token}` } : {}), ...options.headers },
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) { if (response.status === 401) session = null; throw new Error(payload.error ?? `服务器返回 ${response.status}`); }
  return payload.data;
}
async function fetchImage(route) {
  const response = await fetch(`${settings.serverUrl}${route}`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  const type = response.headers.get('content-type')?.split(';')[0];
  if (!response.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(type)) throw new Error('图片下载失败');
  let size = 0; const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; if (size > 5 * 1024 * 1024) throw new Error('图片过大'); chunks.push(chunk); }
  return { size, dataUrl: `data:${type};base64,${Buffer.concat(chunks).toString('base64')}` };
}
async function records(refresh) {
  const dir = directory();
  const saved = isEditor ? await storage.readJson(path.join(dir, 'records.json'), null) : await storage.pruneRetired(dir);
  if (!refresh && saved) return { ...saved, offline: false, cached: true };
  if (!syncPromise) syncPromise = (isEditor ? storage.syncCache : storage.syncReadOnlyCache)(dir, { ...settings }, route => request(route), fetchImage).finally(() => { syncPromise = null; });
  try { return await syncPromise; }
  catch (error) { if (!saved) throw new Error(`连接失败，尚无本地缓存。${error.message}`); return { ...saved, offline: true, error: error.message }; }
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) throw new Error('无效窗口');
    try { return { ok: true, value: await fn(...args) }; } catch (error) { return { ok: false, error: error.message }; }
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => createWindow());
  app.whenReady().then(async () => {
    try { settings = storage.normalizeSettings({ ...initialSettings, ...await storage.readJson(path.join(root(), 'settings.json'), {}) }); } catch { settings = { ...initialSettings }; }
    applySettings();
    tray = new Tray(nativeImage.createFromBuffer(trayIcon(isEditor)));
    tray.setToolTip(client.name);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: isEditor ? '显示编辑工作台' : '显示失物小窗', click: createWindow },
      { type: 'separator' }, { label: '退出', click: () => app.quit() },
    ]));
    tray.on('double-click', createWindow);
    handle('settings:get', () => settings);
    handle('settings:save', async input => {
      const next = storage.normalizeSettings(input);
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
      settings = next; applySettings(); mainWindow?.webContents.send('settings:changed'); return settings;
    });
    handle('records:list', refresh => records(Boolean(refresh)));
    handle('records:image', id => storage.imageData(directory(), id));
    handle('cache:clear', async () => { if (syncPromise) throw new Error('同步中，请稍后清理'); await fs.rm(directory(), { recursive: true, force: true }); return true; });
    if (!isEditor) {
      handle('cache:choose-directory', async () => {
        const result = await dialog.showOpenDialog(mainWindow, { title: '选择本地记录保存目录', properties: ['openDirectory', 'createDirectory'] });
        return result.canceled ? null : result.filePaths[0];
      });
      handle('window:controls', command => { if (command === 'minimize') mainWindow.minimize(); else if (command === 'close') mainWindow.close(); else throw new Error('无效操作'); });
      handle('window:detail', expanded => {
        if (typeof expanded !== 'boolean') throw new Error('无效展开状态');
        const bounds = mainWindow.getBounds();
        const area = screen.getDisplayMatching(bounds).workArea;
        const width = Math.min(expanded ? 800 : 420, area.width);
        mainWindow.setBounds({ x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)), width });
        return true;
      });
    }
    if (isEditor) require('./editor-handlers.cjs')({
      handle, request, directory, window: () => mainWindow, waitForSync: () => syncPromise?.catch(() => {}),
      getSession: () => session, setSession: value => { session = value; },
    });
    createWindow();
  }).catch(error => { dialog.showErrorBox('启动失败', error.message); app.quit(); });
}
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (!settings.closeToTray) app.quit(); });
app.on('activate', createWindow);
