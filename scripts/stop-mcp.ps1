param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$repoRoot = Resolve-RepoRoot
$entrypoint = Join-Path $repoRoot "dist\src\index.js"
$logsDir = Join-Path $repoRoot "logs"
$pidFile = Join-Path $logsDir "champcity-gpt-mcp.pid"
$statusFile = Join-Path $logsDir "champcity-gpt-mcp.status.json"

function Clear-StatusFiles {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $statusFile -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path $pidFile)) {
  Write-Host "No ChampCity_GPT MCP PID file was found. No launcher-started server appears to be running."
  exit 0
}

$rawProcessId = (Get-Content -LiteralPath $pidFile -Raw).Trim()
if (-not ($rawProcessId -match '^\d+$')) {
  Write-Host "PID file is invalid. Cleaning up stale launcher status files."
  Clear-StatusFiles
  exit 0
}

$targetProcessId = [int]$rawProcessId
$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $targetProcessId" -ErrorAction SilentlyContinue
if (-not $processInfo) {
  Write-Host "PID $targetProcessId is stale. Cleaning up launcher status files."
  Clear-StatusFiles
  exit 0
}

$commandLine = [string]$processInfo.CommandLine
$normalizedCommand = $commandLine.ToLowerInvariant()
$normalizedRepo = $repoRoot.ToLowerInvariant()
$normalizedEntrypoint = $entrypoint.ToLowerInvariant()

if (-not ($normalizedCommand.Contains($normalizedRepo) -or $normalizedCommand.Contains($normalizedEntrypoint))) {
  throw "Refusing to stop PID $targetProcessId because its command line does not reference this repo or entrypoint."
}

Write-Host "Stopping ChampCity_GPT MCP server PID $targetProcessId..."
Stop-Process -Id $targetProcessId -ErrorAction Stop
Clear-StatusFiles
Write-Host "Stopped."
