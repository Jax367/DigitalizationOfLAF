param([string]$ServerUrl = 'http://127.0.0.1:8787')
$ErrorActionPreference = 'Stop'
$serverAddress = [Uri]$ServerUrl
if (-not $serverAddress.IsAbsoluteUri -or $serverAddress.Scheme -notin @('http','https')) { throw '服务器地址必须是 http:// 或 https:// 地址。' }
$editorUrl = $serverAddress.GetLeftPart([UriPartial]::Authority) + '/editor/'
Start-Process -FilePath $editorUrl -WindowStyle Normal
Write-Host "已在浏览器打开网页编辑端：$editorUrl"