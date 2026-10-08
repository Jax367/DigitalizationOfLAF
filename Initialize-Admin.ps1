param([string]$ServerUrl = 'http://127.0.0.1:8787')
$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot 'laf-backend/.dev.vars'
if (-not (Test-Path $configPath)) { throw '请先运行 Start-Server.ps1 生成本地配置。' }
$configText = Get-Content -LiteralPath $configPath -Raw
$keyMatch = [regex]::Match($configText, '(?m)^ADMIN_BOOTSTRAP_KEY="([^"]+)"')
if (-not $keyMatch.Success) { throw '本地初始化密钥缺失。' }
$username = Read-Host '管理员用户名（3–40 个字符）'
$securePassword = Read-Host '管理员密码（至少 10 个字符）' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $body = @{ username = $username; password = $plainPassword } | ConvertTo-Json
  $result = Invoke-RestMethod -Uri "$($ServerUrl.TrimEnd('/'))/api/auth/bootstrap" -Method Post -ContentType 'application/json; charset=utf-8' -Headers @{ 'X-Bootstrap-Key' = $keyMatch.Groups[1].Value } -Body ([Text.Encoding]::UTF8.GetBytes($body))
  if ($result.success) { Write-Host '管理员创建成功，现在可在编辑客户端登录。' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $plainPassword = $null
  $body = $null
}
