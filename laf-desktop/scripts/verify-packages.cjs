const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const { root } = require('./prepare.cjs');
const identities = [];
for (const role of ['viewer']) {
  const project = path.join(root, `laf-${role}`);
  const archive = path.join(project, 'dist/win-unpacked/resources/app.asar');
  const entries = asar.listPackage(archive).map(entry => entry.replaceAll('\\', '/'));
  for (const relative of ['src/network.cjs', 'src/main.cjs', 'src/device-client.cjs', 'src/client-config.cjs', 'src/preload.cjs', 'src/storage.cjs', 'src/ui/app.js', 'src/ui/index.html', 'src/ui/styles.css', 'src/desktop-layer.cjs','src/preload-reader.cjs','src/ui/reader.html','src/ui/reader.js','src/ui/reader.css','src/side-detail.cjs','src/preload-detail.cjs','src/ui/detail.html','src/ui/detail.js','src/ui/detail.css']) assert.ok(asar.extractFile(archive, path.normalize(relative)).equals(fs.readFileSync(path.join(project, relative))), `${role} 打包源码不一致：${relative}`);
  assert.ok(fs.readFileSync(path.join(project,'dist/win-unpacked/resources/app.asar.unpacked/src/desktop-layer.ps1')).equals(fs.readFileSync(path.join(project,'src/desktop-layer.ps1'))));
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
  assert.equal(pkg.name, `laf-${role}`);
  identities.push(pkg.name);
  const hasEditor = entries.some(file => file.endsWith('/editor-handlers.cjs'));
  assert.equal(hasEditor, role === 'editor');
  const roleStyle = role === 'viewer' ? 'src/ui/viewer.css' : 'src/ui/editor-theme.css';
  assert.ok(asar.extractFile(archive, path.normalize(roleStyle)).equals(fs.readFileSync(path.join(project, roleStyle))));
  if (role === 'viewer') {
    const bridge = asar.extractFile(archive, path.normalize('src/preload.cjs')).toString();
    assert.ok(!/auth:|image:upload|window:editor|invoke\('api'/.test(bridge));
    assert.ok(!asar.extractFile(archive, path.normalize('src/ui/app.js')).toString().includes('/api/auth'));
  }
  const label = role === 'viewer' ? 'Viewer' : 'Editor';
  for (const file of [`dist/win-unpacked/LAF-${label}.exe`, `dist/LAF-${label}-Setup-${pkg.version}.exe`]) assert.ok(fs.statSync(path.join(project, file)).size > 1024 * 1024);
  console.log(`${role} 独立 EXE / 安装包验证通过，源码一致，能力隔离正确`);
}
assert.equal(new Set(identities).size, 1);
