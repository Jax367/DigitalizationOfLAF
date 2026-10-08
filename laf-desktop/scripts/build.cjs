const path = require('node:path');
const { spawn } = require('node:child_process');
const { prepare } = require('./prepare.cjs');
async function build() {
  if(process.argv[2] && process.argv[2] !== 'viewer')throw new Error('编辑端已迁移到网页，不再构建桌面编辑安装包');
  const roles = process.argv[2] ? [process.argv[2]] : ['viewer'];
  for (const role of roles) {
    const project = await prepare(role);
    const electronDist = path.resolve(__dirname, '../node_modules/electron/dist');
    const cli = require.resolve('electron-builder/cli.js');
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, '--projectDir', project, '--win', 'nsis', `--config.electronDist=${electronDist}`], { stdio: 'inherit', env: { ...process.env, ELECTRON_BUILDER_CACHE: path.resolve(__dirname, '../.npm-cache/builder') } });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${role} 构建失败：${code}`)));
    });
  }
}
build().catch(error => { console.error(error); process.exitCode = 1; });
