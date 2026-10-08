const { spawn } = require('node:child_process');
const { prepare } = require('./prepare.cjs');
async function launch() {
  const project = await prepare(process.argv[2] ?? 'viewer');
  const child = spawn(require('electron'), [project], { stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
launch().catch(error => { console.error(error); process.exitCode = 1; });
