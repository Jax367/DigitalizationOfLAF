param([int]$Port = 8787, [switch]$Lan, [string]$ListenAddress = '127.0.0.1')
$ErrorActionPreference = 'Stop'
function Test-PrivateAddress([string]$Address) {
  $parsedAddress = $null
  if (-not [Net.IPAddress]::TryParse($Address, [ref]$parsedAddress)) { return $false }
  if ([Net.IPAddress]::IsLoopback($parsedAddress)) { return $true }
  if ($parsedAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
  $addressBytes = $parsedAddress.GetAddressBytes()
  return ($addressBytes[0] -eq 10 -or ($addressBytes[0] -eq 192 -and $addressBytes[1] -eq 168) -or ($addressBytes[0] -eq 172 -and $addressBytes[1] -ge 16 -and $addressBytes[1] -le 31) -or ($addressBytes[0] -eq 100 -and $addressBytes[1] -ge 64 -and $addressBytes[1] -le 127))
}
if ($Port -lt 1 -or $Port -gt 65535) { throw '端口需在 1–65535 之间。' }
if ($Lan -and -not $PSBoundParameters.ContainsKey('ListenAddress')) {
  $privateAddress = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -ne '127.0.0.1' -and (Test-PrivateAddress $_.IPAddress) } | Select-Object -First 1 -ExpandProperty IPAddress
  if (-not $privateAddress) { throw '未找到私网地址，请使用 -ListenAddress 指定实际私网 IP。' }
  $ListenAddress = $privateAddress
}
if (-not (Test-PrivateAddress $ListenAddress)) { throw '开发服务只允许回环或指定私网地址，不能监听公网或 0.0.0.0。' }
Write-Host "开发服务监听 $ListenAddress；不要将此端口转发至公网。正式服务请使用 HTTPS 部署配置。"
Push-Location (Join-Path $PSScriptRoot 'laf-backend')
try {
  if (-not (Test-Path 'node_modules/wrangler/bin/wrangler.js')) { throw '请先在 laf-backend 运行 npm install。' }
  $env:WRANGLER_SEND_METRICS = 'false'
  $env:WRANGLER_LOG_PATH = Join-Path (Get-Location) '.wrangler/logs/server.log'
  $env:XDG_CONFIG_HOME = Join-Path (Get-Location) '.wrangler/config'
  node scripts/init-config.mjs
  if ($LASTEXITCODE -ne 0) { throw '配置初始化失败' }
  node node_modules/wrangler/bin/wrangler.js d1 migrations apply laf-database --local
  if ($LASTEXITCODE -ne 0) { throw '数据库迁移失败' }
  node node_modules/wrangler/bin/wrangler.js dev --ip $ListenAddress --port $Port
} finally { Pop-Location }
