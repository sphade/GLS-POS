# Preflight + backup. Contains NO wrangler calls: wrangler needs an interactive
# terminal for its OAuth token, so `secret put` and `deploy` are run separately.
$base = "https://gls-pos-server.sphade012.workers.dev"
$keep = "store_94d4e572-9546-461b-aacb-7757356535d8"
$key = (Get-Content "$env:TEMP\gls-admin-key.txt" -Raw).Trim()

Write-Output "--- gate check ---"
Write-Output ("no key    -> " + (curl.exe -s -o NUL -w '%{http_code}' "$base/maintenance/store/$keep/stats"))
Write-Output ("wrong key -> " + (curl.exe -s -o NUL -w '%{http_code}' -H "x-admin-key: nope" "$base/maintenance/store/$keep/stats"))
Write-Output ("good key  -> " + (curl.exe -s -o NUL -w '%{http_code}' -H "x-admin-key: $key" "$base/maintenance/store/$keep/stats"))
Write-Output ""
Write-Output "--- stats BEFORE ---"
Write-Output (curl.exe -s -H "x-admin-key: $key" "$base/maintenance/store/$keep/stats")

# Backup lands OUTSIDE the repo so real sales data can never be committed.
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $env:USERPROFILE "Documents\gls-pos-sales-backup-$stamp.json"
Write-Output ""
Write-Output "--- exporting trading rows to a backup ---"
curl.exe -s -H "x-admin-key: $key" "$base/maintenance/store/$keep/export-sales" -o $backup

$parsed = Get-Content $backup -Raw | ConvertFrom-Json
if (-not $parsed.ok) { Write-Output "EXPORT FAILED: $(Get-Content $backup -Raw)"; exit 1 }

Write-Output "backup file : $backup"
Write-Output "size        : $([math]::Round((Get-Item $backup).Length / 1KB, 1)) KB"
Write-Output "rows        : $($parsed.data.rows.Count)"
$parsed.data.rows | Group-Object -Property collection | Sort-Object Count -Descending |
  ForEach-Object { Write-Output ("  {0,-18} {1}" -f $_.Name, $_.Count) }
Set-Content -Path "$PSScriptRoot\backup-path.txt" -Value $backup -NoNewline
Write-Output ""
Write-Output "Backup verified. Safe to run clear.ps1."
