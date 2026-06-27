$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$publicBaseUrl = if ([string]::IsNullOrWhiteSpace($env:CHAMPCITY_GPT_PUBLIC_BASE_URL)) { "https://mcp.example.com" } else { $env:CHAMPCITY_GPT_PUBLIC_BASE_URL.TrimEnd("/") }
$publicHost = ([Uri]$publicBaseUrl).Host
$failed = $false
$warned = $false

function Write-Check {
  param(
    [ValidateSet("PASS", "WARN", "FAIL")]
    [string]$Status,
    [string]$Name,
    [string]$Detail
  )

  Write-Host "$Status $Name - $Detail"
  if ($Status -eq "FAIL") {
    $script:failed = $true
  }
  if ($Status -eq "WARN") {
    $script:warned = $true
  }
}

function Read-JsonFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

Write-Host "ChampCity_GPT tunnel readiness"
Write-Host "Repo: $repoRoot"

$healthUrl = "http://127.0.0.1:3333/health"
try {
  $health = Invoke-WebRequest -Uri $healthUrl -Method Get -UseBasicParsing -TimeoutSec 5
  $healthJson = $health.Content | ConvertFrom-Json
  if ($health.StatusCode -eq 200 -and $healthJson.status -eq "ok") {
    Write-Check "PASS" "local HTTP server health" "$healthUrl returned status ok."
  } else {
    Write-Check "FAIL" "local HTTP server health" "$healthUrl did not return status ok."
  }
} catch {
  Write-Check "FAIL" "local HTTP server health" "$healthUrl failed: $($_.Exception.Message)"
}

$envTokenConfigured = -not [string]::IsNullOrWhiteSpace($env:CHAMPCITY_GPT_HTTP_AUTH_TOKEN)
$authFile = Join-Path $repoRoot "config\http-auth.local.json"
$localTokenConfigured = $false
try {
  $authConfig = Read-JsonFile $authFile
  $localTokenConfigured = $null -ne $authConfig -and -not [string]::IsNullOrWhiteSpace([string]$authConfig.httpAuthToken)
} catch {
  Write-Check "FAIL" "HTTP auth token config" "Invalid config\http-auth.local.json: $($_.Exception.Message)"
}

if ($envTokenConfigured -or $localTokenConfigured) {
  $source = if ($envTokenConfigured) { "environment" } else { "local file" }
  Write-Check "PASS" "HTTP auth token configured" "Token is configured via $source. Token value was not printed."
} else {
  Write-Check "FAIL" "HTTP auth token configured" "No token found in CHAMPCITY_GPT_HTTP_AUTH_TOKEN or config\http-auth.local.json."
}

$unauthLocal = ([string]$env:CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP).Trim().ToLowerInvariant() -eq "true"
if ($unauthLocal) {
  Write-Check "FAIL" "unauthenticated local mode disabled" "CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP=true. Do not tunnel unauthenticated local mode."
} else {
  Write-Check "PASS" "unauthenticated local mode disabled" "Unauthenticated local mode is disabled."
}

$writeMode = ([string]$env:CHAMPCITY_GPT_WRITE_MODE).Trim().ToLowerInvariant()
if (-not $writeMode) {
  $writeMode = if (([string]$env:CHAMPCITY_GPT_ENABLE_WRITE_TOOLS).Trim().ToLowerInvariant() -eq "true") { "docs" } else { "off" }
}
if ($writeMode -ne "off") {
  Write-Check "WARN" "Write mode off" "CHAMPCITY_GPT_WRITE_MODE=$writeMode. Keep write mode off for first ChatGPT testing."
} else {
  Write-Check "PASS" "Write mode off" "Write mode is off unless explicitly changed."
}

$allowedConfigPath = Join-Path $repoRoot "config\allowed-roots.local.json"
try {
  $allowedConfig = Read-JsonFile $allowedConfigPath
  $roots = @()
  if (-not [string]::IsNullOrWhiteSpace($env:CHAMPCITY_GPT_ALLOWED_ROOTS)) {
    $roots = $env:CHAMPCITY_GPT_ALLOWED_ROOTS -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  } elseif ($null -ne $allowedConfig -and $allowedConfig.allowedRoots) {
    $roots = @($allowedConfig.allowedRoots)
  } else {
    $roots = @($repoRoot)
  }

  $missing = @($roots | Where-Object { -not (Test-Path -LiteralPath $_) })
  if ($missing.Count -eq 0) {
    Write-Check "PASS" "allowed roots exist" "$($roots.Count) allowed root(s) exist."
  } else {
    Write-Check "FAIL" "allowed roots exist" "Missing: $($missing -join ', ')"
  }
} catch {
  Write-Check "FAIL" "allowed roots exist" "Could not read allowed roots: $($_.Exception.Message)"
}

try {
  $dns = Resolve-DnsName -Name $publicHost -ErrorAction Stop
  $targets = @($dns | ForEach-Object {
    if ($_.NameHost) { $_.NameHost } elseif ($_.IPAddress) { $_.IPAddress }
  } | Where-Object { $_ })
  Write-Check "PASS" "$publicHost DNS" "Resolved publicly: $($targets -join ', ')"
} catch {
  Write-Check "WARN" "$publicHost DNS" "DNS is not resolving yet or is unavailable from this machine."
}

$cloudflared = Get-Command "cloudflared" -ErrorAction SilentlyContinue
if ($cloudflared) {
  Write-Check "PASS" "cloudflared installed" $cloudflared.Source
} else {
  Write-Check "WARN" "cloudflared installed" "cloudflared was not found on PATH."
}

$guidePath = Join-Path $repoRoot "docs\CLOUDFLARE_TUNNEL_SETUP.md"
$templatePath = Join-Path $repoRoot "examples\cloudflared-config.example.yml"
if (Test-Path -LiteralPath $guidePath) {
  Write-Check "PASS" "Cloudflare setup guide exists" $guidePath
} else {
  Write-Check "FAIL" "Cloudflare setup guide exists" $guidePath
}

if (Test-Path -LiteralPath $templatePath) {
  Write-Check "PASS" "Cloudflare config template exists" $templatePath
} else {
  Write-Check "FAIL" "Cloudflare config template exists" $templatePath
}

if ($failed) {
  Write-Host "FAIL Tunnel is not ready."
  exit 1
}

if ($warned) {
  Write-Host "WARN Tunnel baseline is usable only after warnings are understood."
  exit 0
}

Write-Host "PASS Tunnel readiness checks passed."
exit 0
