param([switch]$Editor)
$ErrorActionPreference = 'Stop'
if ($Editor) { & (Join-Path $PSScriptRoot 'Start-Editor.ps1'); return }
$toolPath = Join-Path $PSScriptRoot 'laf-desktop'
$electronPath = Join-Path $toolPath 'node_modules/electron/dist/electron.exe'
if (-not (Test-Path $electronPath)) { throw '请先在 laf-desktop 运行 npm install；如 Electron 运行时未安装，再运行 node node_modules/electron/install.js。' }
$clientRole = if ($Editor) { 'editor' } else { 'viewer' }
node (Join-Path $toolPath 'scripts/prepare.cjs') $clientRole
if ($LASTEXITCODE -ne 0) { throw '客户端准备失败' }
$clientPath = Join-Path $PSScriptRoot "laf-$clientRole"
Start-Process -FilePath $electronPath -ArgumentList @('"' + $clientPath + '"') -WindowStyle Normal