const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'laf-desktop/src');
const definitions = {
  viewer: { role: 'viewer', name: '失物招领只读客户端', profile: 'laf-viewer', appId: 'school.laf.viewer' },
  editor: { role: 'editor', name: '失物招领编辑客户端', profile: 'laf-editor', appId: 'school.laf.editor' },
};
async function prepare(role) {
  if(role==='editor')throw new Error('编辑端已迁移到 laf-backend/public/editor，请使用浏览器访问 /editor/');
  const config = definitions[role]; if (!config) throw new Error('客户端类型必须为 viewer 或 editor');
  const target = path.join(root, `laf-${role}`, 'src');
  await fs.mkdir(path.join(target, 'ui'), { recursive: true });
  for (const file of ['main.cjs', 'storage.cjs', 'tray-icon.cjs', 'device-client.cjs', 'desktop-layer.cjs', 'desktop-layer.ps1','preload-reader.cjs']) await fs.copyFile(path.join(source, file), path.join(target, file));
  await fs.writeFile(path.join(target, 'client-config.cjs'), `module.exports = ${JSON.stringify(config, null, 2)};\n`);
  await fs.copyFile(path.join(source, role === 'viewer' ? 'preload-viewer.cjs' : 'preload.cjs'), path.join(target, 'preload.cjs'));
  await fs.copyFile(path.join(source, 'ui', role === 'viewer' ? 'viewer.js' : 'app.js'), path.join(target, 'ui/app.js'));
  await fs.copyFile(path.join(source, 'ui/styles.css'), path.join(target, 'ui/styles.css'));
  let html = await fs.readFile(path.join(source, 'ui/index.html'), 'utf8');
  html = html.replace('<title>校园失物招领</title>', `<title>${config.name}</title>`);
  if (role === 'editor') {
    await fs.copyFile(path.join(source, 'editor-handlers.cjs'), path.join(target, 'editor-handlers.cjs'));
    await fs.copyFile(path.join(source, 'ui/editor-theme.css'), path.join(target, 'ui/editor-theme.css'));
    html = html.replace('</head>', '  <link rel="stylesheet" href="editor-theme.css">\n</head>');
  } else {
    for(const file of ['reader.html','reader.js','reader.css'])await fs.copyFile(path.join(source,'ui',file),path.join(target,'ui',file));
    await fs.copyFile(path.join(source, 'ui/viewer.css'), path.join(target, 'ui/viewer.css'));
    html = html.replace('</head>', '  <link rel="stylesheet" href="viewer.css">\n</head>');
  }
  await fs.writeFile(path.join(target, 'ui/index.html'), html);
  return path.dirname(target);
}
module.exports = { prepare, definitions, root };
if (require.main === module) (async () => { for (const role of process.argv[2] ? [process.argv[2]] : ['viewer']) console.log(`已准备独立 GUI 客户端：${await prepare(role)}`); })().catch(error => { console.error(error); process.exitCode = 1; });
