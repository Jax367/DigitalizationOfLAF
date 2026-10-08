const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const store = require('../src/storage.cjs');
test('设置接受 IP 和域名，限制协议、端口以外的路径和选项范围', () => {
  assert.equal(store.normalizeSettings({ ...store.defaults, serverUrl: '192.168.1.10:8787' }).serverUrl, 'http://192.168.1.10:8787');
  for (const input of [{ serverUrl: 'file:///secret' }, { serverUrl: 'http://user:password@host' }, { serverUrl: 'http://host/api' }, { refreshSeconds: 1 }, { cacheMB: -1 }, {detailSide:'top'}, {detailWidth:200}, {detailWidth:1001}]) assert.throws(() => store.normalizeSettings({ ...store.defaults, ...input }));
});
test('服务器缓存隔离，完整记录和图片可从磁盘恢复，删除记录会清理图片', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'laf-cache-'));
  try {
    const dir = store.cacheDirectory(root, 'http://server-a');
    assert.notEqual(dir, store.cacheDirectory(root, 'http://server-b'));
    const id = '11111111-1111-1111-1111-111111111111';
    const records = [{ id: 1, title: '杯子', description: '蓝色', image_id: id, status: 'found', created_at: '2026-10-06 01:00:00' }];
    const image = { size: 3, dataUrl: 'data:image/png;base64,YWJj' };
    await store.syncCache(dir, store.defaults, async () => records, async () => image);
    assert.deepEqual((await store.readJson(path.join(dir, 'records.json'))).items, records);
    assert.equal(await store.imageData(dir, id), image.dataUrl);
    assert.equal((await store.syncCache(dir, store.defaults, async () => records, async () => { throw new Error('离线'); })).missingImages, 0);
    await assert.rejects(store.syncCache(dir, store.defaults, async () => { throw new Error('离线'); }, async () => image));
    assert.equal(await store.imageData(dir, id), image.dataUrl);
    await store.syncCache(dir, store.defaults, async () => [], async () => image);
    assert.equal(await store.imageData(dir, id), null);
    await assert.rejects(store.imageData(dir, '../secrets'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('图片下载失败不丢失记录，大小上限阻止图片写入', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'laf-cache-'));
  try {
    const id = '22222222-2222-2222-2222-222222222222';
    const records = [{ id: 2, image_id: id }];
    assert.equal((await store.syncCache(root, store.defaults, async () => records, async () => { throw new Error('断网'); })).missingImages, 1);
    assert.equal((await store.syncCache(root, { ...store.defaults, cacheMB: 10 }, async () => records, async () => ({ size: 11 * 1024 * 1024, dataUrl: 'x' }))).missingImages, 1);
    assert.equal(await store.imageData(root, id), null);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
