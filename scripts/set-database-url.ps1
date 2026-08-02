# Sets DATABASE_URL on Netlify from a password argument (or $env:SUPABASE_DB_PASSWORD).
# Usage:
#   .\scripts\set-database-url.ps1 -DbPassword 'your-supabase-db-password'
# Does not print the full secret.

param(
  [Parameter(Mandatory = $false)]
  [string]$DbPassword = $env:SUPABASE_DB_PASSWORD
)

$ErrorActionPreference = "Stop"
$siteId = "9e2c7c5e-f0bb-4320-87ca-0a7a6a586a9b"
$projectRef = "yoeojthptlqxtictktfl"
$region = "eu-west-1"

if (-not $DbPassword) {
  Write-Output "MISSING_PASSWORD"
  Write-Output "Provide -DbPassword or set SUPABASE_DB_PASSWORD."
  Write-Output "Get it from: https://supabase.com/dashboard/project/$projectRef/settings/database"
  exit 2
}

$cfgPath = Join-Path $env:APPDATA "netlify\Config\config.json"
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$token = $null
foreach ($u in $cfg.users.PSObject.Properties) {
  if ($u.Value.auth.token) { $token = [string]$u.Value.auth.token; break }
}
if (-not $token) { throw "No Netlify token found in $cfgPath" }

$headers = @{
  Authorization = "Bearer $token"
  "Content-Type" = "application/json"
  "User-Agent" = "harbor-ai-setup"
}

$site = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/sites/$siteId" -Headers $headers
$accountId = $site.account_id

# URL-encode password for connection string
$encPass = [System.Uri]::EscapeDataString($DbPassword)
# Transaction pooler (PgBouncer) — required for serverless
$dbUrl = "postgresql://postgres.$projectRef`:$encPass@aws-0-$region.pooler.supabase.com:6543/postgres"

$bodyObj = @(
  @{
    key = "DATABASE_URL"
    scopes = @("builds", "functions", "runtime", "post_processing")
    values = @(@{ value = $dbUrl; context = "all" })
  }
)
$body = $bodyObj | ConvertTo-Json -Depth 6 -Compress

try {
  $null = Invoke-RestMethod -Method Post `
    -Uri "https://api.netlify.com/api/v1/accounts/$accountId/env?site_id=$siteId" `
    -Headers $headers `
    -Body $body
  Write-Output "CREATED"
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  if ($status -eq 409 -or $status -eq 422) {
    $putBody = @{
      key = "DATABASE_URL"
      scopes = @("builds", "functions", "runtime", "post_processing")
      values = @(@{ value = $dbUrl; context = "all" })
    } | ConvertTo-Json -Depth 6 -Compress
    $null = Invoke-RestMethod -Method Put `
      -Uri "https://api.netlify.com/api/v1/accounts/$accountId/env/DATABASE_URL?site_id=$siteId" `
      -Headers $headers `
      -Body $putBody
    Write-Output "UPDATED"
  } else {
    throw
  }
}

$envs = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/accounts/$accountId/env?site_id=$siteId" -Headers $headers
$keys = @($envs | ForEach-Object { $_.key }) | Sort-Object
Write-Output ("KEYS=" + ($keys -join ","))
$hasDb = $keys -contains "DATABASE_URL"
Write-Output ("DATABASE_URL_SET=$hasDb")

if ($hasDb) {
  $entry = $envs | Where-Object { $_.key -eq "DATABASE_URL" } | Select-Object -First 1
  $val = [string]$entry.values[0].value
  $masked = if ($val.Length -ge 8) { $val.Substring(0,4) + "..." + $val.Substring($val.Length-4) } else { "(short)" }
  Write-Output "DATABASE_URL_MASKED=$masked"
  Write-Output "DATABASE_URL_LEN=$($val.Length)"
  Write-Output "LOOKS_LIKE_POSTGRES=$($val -match '^postgres(ql)?://')"
}

Write-Output "NOTE: Redeploy the site (or wait for next deploy) so functions pick up the new env var."
