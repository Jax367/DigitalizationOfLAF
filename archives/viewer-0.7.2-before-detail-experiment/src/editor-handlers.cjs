const path = require('node:path');
const fs = require('node:fs/promises');
const { dialog } = require('electron');
const storage = require('./storage.cjs');

// This module and its IPC capabilities are shipped only in the editor application.
module.exports = function registerEditor({ handle, request, directory, window, waitForSync, getSession, setSession }) {
  handle('auth:status', () => getSession()?.user ?? null);
  handle('auth:login', async body => {
    const session = await request('/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
    setSession(session); return session.user;
  });
  handle('auth:register', body => request('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }));
  handle('auth:logout', async () => {
    try { await request('/api/auth/logout', { method: 'POST' }); } finally { setSession(null); }
    return true;
  });
  handle('api', async (route, method, body) => {
    if (!getSession()) throw new Error('请先登录');
    const permitted = (/^\/api\/items(?:\/[1-9]\d*)?$/.test(route) && ['GET', 'POST', 'PUT', 'DELETE'].includes(method))
      || (/^\/api\/images\/[a-f0-9-]{36}$/.test(route) && method === 'DELETE')
      || (/^\/api\/users(?:\/[1-9]\d*)?$/.test(route) && ['GET', 'PATCH'].includes(method))
      || (route === '/api/logs' && method === 'GET') || (route === '/api/auth/password' && method === 'POST');
    if (!permitted) throw new Error('不支持的操作');
    const result = await request(route, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (route === '/api/auth/password') setSession(null);
    return result;
  });
  handle('image:upload', async () => {
    if (!getSession()) throw new Error('请先登录');
    await waitForSync();
    const result = await dialog.showOpenDialog(window(), { title: '选择失物图片（最多 5 MB）', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if ((await fs.stat(file)).size > 5 * 1024 * 1024) throw new Error('图片不能超过 5 MB');
    const bytes = await fs.readFile(file);
    const image = await request('/api/images', { method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream' } });
    const cached = { size: bytes.length, dataUrl: `data:${image.content_type};base64,${bytes.toString('base64')}` };
    await storage.writeJson(path.join(directory(), 'images', `${image.id}.json`), cached);
    return { ...image, dataUrl: cached.dataUrl, name: path.basename(file) };
  });
};
