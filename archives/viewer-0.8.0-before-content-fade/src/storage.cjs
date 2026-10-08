const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const defaults = { serverUrl: 'http://127.0.0.1:8787', autoStart: false, alwaysOnTop: false, windowPlacement: 'desktop', experimentalReaderWindow: true, refreshSeconds: 60, showClaimed: false, closeToTray: true, cacheMB: 100, cacheDirectory: '', theme: 'light', transparency: 22, windowWidth:420, windowHeight:650, detailSide:'right', detailWidth:380 };
function normalizeSettings(input) {
  let text = String(input.serverUrl ?? defaults.serverUrl).trim();
  if (!text.includes('://')) text = `http://${text}`;
  const url = new URL(text);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('服务器地址格式：IP:端口 或 https://域名');
  const refreshSeconds = Number(input.refreshSeconds);
  const cacheMB = Number(input.cacheMB);
  if (!Number.isInteger(refreshSeconds) || refreshSeconds < 15 || refreshSeconds > 3600) throw new Error('刷新间隔需要 15–3600 秒');
  if (!Number.isInteger(cacheMB) || cacheMB < 10 || cacheMB > 1024) throw new Error('图片缓存大小需要 10–1024 MB');
  const result = { serverUrl: url.origin, refreshSeconds, cacheMB };
  const theme = input.theme ?? defaults.theme;
  const transparency = input.transparency ?? defaults.transparency;
  if (!['light', 'dark'].includes(theme)) throw new Error('主题需要选择白色系或黑色系');
  if (!Number.isInteger(transparency) || transparency < 0 || transparency > 100) throw new Error('透明度需要为 0–100%');
  result.theme = theme;
  result.transparency = transparency;
  result.windowPlacement=input.windowPlacement ?? defaults.windowPlacement;
  if(!['desktop','top'].includes(result.windowPlacement))throw new Error('窗口层级无效');
  result.detailSide=input.detailSide ?? defaults.detailSide;
  if(!['left','right'].includes(result.detailSide))throw new Error('详情位置需要选择左侧或右侧');
  for(const [key,min,max] of [['windowWidth',340,2400],['windowHeight',360,1800],['detailWidth',300,1000]]) {
    const value=input[key] ?? defaults[key];
    if(!Number.isInteger(value)||value<min||value>max)throw new Error('窗口尺寸超出允许范围');
    result[key]=value;
  }
  const cacheRoot = input.cacheDirectory ?? '';
  if (typeof cacheRoot !== 'string' || (cacheRoot && !path.isAbsolute(cacheRoot))) throw new Error('本地记录保存目录必须为绝对路径');
  result.cacheDirectory = cacheRoot ? path.resolve(cacheRoot) : '';
  for (const key of ['autoStart', 'alwaysOnTop', 'showClaimed', 'closeToTray']) {
    if (typeof input[key] !== 'boolean') throw new Error(`设置 ${key} 格式错误`);
    result[key] = input[key];
  }
  result.experimentalReaderWindow=input.experimentalReaderWindow ?? defaults.experimentalReaderWindow;
  if(typeof result.experimentalReaderWindow!=='boolean')throw new Error('试验功能设置无效');
  result.alwaysOnTop=result.windowPlacement==='top';
  return result;
}
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2));
  await fs.rename(temporary, file);
}
function cacheDirectory(root, serverUrl) {
  return path.join(root, 'laf-cache', createHash('sha256').update(serverUrl).digest('hex').slice(0, 24));
}
function imageFile(directory, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效图片引用');
  return path.join(directory, 'images', `${id}.json`);
}
async function imageData(directory, id) {
  if (!id) return null;
  return (await readJson(imageFile(directory, id), null))?.dataUrl ?? null;
}
async function syncCache(directory, settings, fetchJson, fetchImage) {
  const items = await fetchJson('/api/items');
  if (!Array.isArray(items)) throw new Error('服务器记录格式错误');
  let used = 0;
  let missingImages = 0;
  const kept = new Set();
  for (const item of items) {
    if (!item.image_id || kept.has(item.image_id)) continue;
    const file = imageFile(directory, item.image_id);
    let image = await readJson(file, null);
    if (image && used + image.size > settings.cacheMB * 1024 * 1024) { missingImages++; continue; }
    if (!image) {
      if (used >= settings.cacheMB * 1024 * 1024) { missingImages++; continue; }
      try {
        image = await fetchImage(`/api/images/${item.image_id}`);
        if (used + image.size > settings.cacheMB * 1024 * 1024) { missingImages++; continue; }
        await writeJson(file, image);
      } catch { missingImages++; continue; }
    }
    used += image.size;
    kept.add(item.image_id);
  }
  const snapshot = { items, syncedAt: new Date().toISOString(), missingImages };
  await writeJson(path.join(directory, 'records.json'), snapshot);
  const imagesDir = path.join(directory, 'images');
  for (const file of await fs.readdir(imagesDir).catch(() => [])) {
    if (/^[a-f0-9-]{36}\.json$/.test(file) && !kept.has(file.slice(0, -5))) await fs.unlink(path.join(imagesDir, file));
  }
  return { ...snapshot, offline: false };
}
const WEEK = 7 * 24 * 60 * 60 * 1000;
const utcTime = value => Date.parse(value?.includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
async function pruneRetired(directory, time = Date.now()) {
  const snapshot = await readJson(path.join(directory, 'records.json'), null);
  if (!snapshot) return null;
  const items = snapshot.items.filter(item => item.status !== 'claimed' || !Number.isFinite(utcTime(item._claimedAt)) || time < utcTime(item._claimedAt) + WEEK);
  if (items.length !== snapshot.items.length) { snapshot.items = items; await writeJson(path.join(directory, 'records.json'), snapshot); }
  const referenced = new Set(items.map(item => item.image_id));
  for (const file of await fs.readdir(path.join(directory, 'images')).catch(() => [])) {
    if (/^[a-f0-9-]{36}\.json$/.test(file) && !referenced.has(file.slice(0, -5))) await fs.unlink(path.join(directory, 'images', file));
  }
  return snapshot;
}
async function syncReadOnlyCache(directory, settings, fetchJson, fetchImage, time = Date.now()) {
  const previous = await pruneRetired(directory, time);
  const fresh = await fetchJson('/api/items?status=found');
  if (!Array.isArray(fresh) || fresh.some(item => item.status !== 'found')) throw new Error('服务器必须返回未认领记录');
  const active = new Set(fresh.map(item => item.id));
  const absent = (previous?.items ?? []).filter(item => !active.has(item.id));
  const retained = [];
  for (let offset = 0; offset < absent.length; offset += 100) {
    const batch = absent.slice(offset, offset + 100);
    const states = await fetchJson(`/api/items/cache-status?ids=${batch.map(item => item.id).join(',')}`);
    const byId = new Map(states.map(state => [state.id, state]));
    for (const old of batch) {
      const state = byId.get(old.id);
      if (state?.status === 'claimed') {
        const claimedAt = state.claimed_at ?? old._claimedAt ?? new Date(time).toISOString();
        if (time < utcTime(claimedAt) + WEEK) retained.push({ ...old, status: 'claimed', _claimedAt: claimedAt });
      } else if (state?.status === 'found') retained.push({ ...old, status: 'found' }); // A concurrent unclaim will refresh fully next cycle.
      else if (!state) throw new Error('认领状态核对不完整');
    }
  }
  // Use the existing bounded image cache, preserving hidden claimed records until their deadline.
  return syncCache(directory, settings, async () => [...fresh, ...retained], fetchImage);
}
module.exports = { defaults, normalizeSettings, readJson, writeJson, cacheDirectory, imageData, syncCache, syncReadOnlyCache, pruneRetired, WEEK };
