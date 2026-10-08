const { execFileSync } = require('node:child_process');
const path = require('node:path');
for (const file of ['src/main.cjs','src/side-detail.cjs','src/preload-detail.cjs','src/ui/detail.js','src/ui/reader.js', 'src/device-client.cjs', 'src/preload.cjs', 'src/preload-viewer.cjs', 'src/editor-handlers.cjs', 'src/storage.cjs', 'src/tray-icon.cjs', 'src/ui/app.js', 'src/ui/viewer.js', 'scripts/prepare.cjs', 'scripts/build.cjs', 'scripts/launch.cjs', '../laf-backend/public/editor/app.js', '../laf-backend/public/editor/admin.js']) execFileSync(process.execPath, ['--check', path.resolve(file)], { stdio: 'inherit' });
console.log('桌面端 JavaScript 语法检查通过');
