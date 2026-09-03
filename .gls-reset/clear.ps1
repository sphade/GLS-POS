# Destructive. Only run after setup.ps1 has written a verified backup.
# ASCII only: non-ASCII punctuation gets mangled by the default file encoding
# and breaks the parser.
$base = "https://gls-pos-server.sphade012.workers.dev"
$keep = "store_94d4e572-9546-461b-aacb-7757356535d8"
$key = (Get-Content "$env:TEMP\gls-admin-key.txt" -Raw).Trim()

$backupPath = "$PSScriptRoot\backup-path.txt"
if (-not (Test-Path $backupPath)) { throw "ABORT: no backup recorded. Run setup.ps1 first." }
$backup = (Get-Content $backupPath -Raw).Trim()
if (-not (Test-Path $backup)) { throw "ABORT: backup file missing at $backup" }
$rows = ((Get-Content $backup -Raw | ConvertFrom-Json).data.rows).Count
if ($rows -lt 1) { throw "ABORT: backup contains no rows" }
Write-Output "backup present: $rows rows at $backup"
Write-Output ""

# Body via file: PowerShell mangles inline JSON quoting on its way to curl.exe.
$bodyFile = Join-Path $env:TEMP "gls-clear-body.json"
Set-Content -Path $bodyFile -Value ('{"confirm":"' + $keep + '"}') -NoNewline -Encoding ascii

Write-Output "--- clearing trading history ---"
$res = curl.exe -s -X POST -H "x-admin-key: $key" -H "Content-Type: application/json" --data-binary "@$bodyFile" "$base/maintenance/store/$keep/clear-sales"
Remove-Item $bodyFile -ErrorAction SilentlyContinue
Write-Output $res
Write-Output ""
Write-Output "--- stats AFTER (catalog must survive) ---"
Write-Output (curl.exe -s -H "x-admin-key: $key" "$base/maintenance/store/$keep/stats")
