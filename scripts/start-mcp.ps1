param(
  [switch]$Background,
  [switch]$NoBuild,
  [switch]$VerboseOutput
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ($VerboseOutput) {
  $VerbosePreference = "Continue"
}

function Resolve-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Assert-CommandExists {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is not installed or is not available on PATH."
  }
}

$repoRoot = Resolve-RepoRoot
$entrypoint = Join-Path $repoRoot "dist\src\index.js"
$logsDir = Join-Path $repoRoot "logs"
$pidFile = Join-Path $logsDir "champcity-gpt-mcp.pid"
$statusFile = Join-Path $logsDir "champcity-gpt-mcp.status.json"
$stdoutLog = Join-Path $logsDir "champcity-gpt-mcp.out.log"
$stderrLog = Join-Path $logsDir "champcity-gpt-mcp.err.log"

Set-Location $repoRoot

if (-not (Test-Path (Join-Path $repoRoot "package.json"))) {
  throw "package.json was not found at $repoRoot. This script must live inside the ChampCity_GPT repo."
}

Assert-CommandExists "node"
Assert-CommandExists "npm"

if (-not (Test-Path (Join-Path $repoRoot "node_modules"))) {
  Write-Host "node_modules is missing. Running npm install..."
  & npm install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with exit code $LASTEXITCODE."
  }
}

if (-not (Test-Path $entrypoint)) {
  if ($NoBuild) {
    throw "MCP entrypoint is missing: $entrypoint. Re-run without -NoBuild or run npm run build."
  }

  Write-Host "MCP entrypoint is missing. Running npm run build..."
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build failed with exit code $LASTEXITCODE."
  }
}

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

if ($Background) {
  $process = Start-Process -FilePath "node" `
    -ArgumentList @($entrypoint) `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

  Set-Content -LiteralPath $pidFile -Value ([string]$process.Id) -Encoding ASCII

  $status = [ordered]@{
    pid = $process.Id
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    entrypoint = $entrypoint
    repoRoot = $repoRoot
  }
  $status | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statusFile -Encoding UTF8

  Write-Host "ChampCity_GPT MCP server started in background."
  Write-Host "PID: $($process.Id)"
  Write-Host "Status: $statusFile"
  exit 0
}

Write-Host "Starting ChampCity_GPT MCP server in foreground over stdio..."
Write-Host "Entrypoint: $entrypoint"
& node $entrypoint
exit $LASTEXITCODE
