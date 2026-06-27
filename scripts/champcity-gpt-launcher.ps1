param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ScriptsDir = Join-Path $RepoRoot "scripts"
$ConfigDir = Join-Path $RepoRoot "config"
$ConfigPath = Join-Path $ConfigDir "allowed-roots.local.json"
$LogsDir = Join-Path $RepoRoot "logs"
$PidFile = Join-Path $LogsDir "champcity-gpt-mcp.pid"
$StatusFile = Join-Path $LogsDir "champcity-gpt-mcp.status.json"
$Entrypoint = Join-Path $RepoRoot "dist\src\index.js"
$ProjectsRoot = Split-Path -Parent $RepoRoot
$SuggestedRoots = @(
  $RepoRoot
)
$DefaultAllowedCommands = @(
  "npm test",
  "npm run lint",
  "npm run typecheck",
  "npm run build",
  "git status",
  "git diff"
)

function Pause-Launcher {
  Write-Host ""
  Read-Host "Press Enter to return to the launcher" | Out-Null
}

function Invoke-LauncherScript {
  param(
    [string]$ScriptName,
    [string[]]$Arguments = @()
  )

  $scriptPath = Join-Path $ScriptsDir $ScriptName
  if (-not (Test-Path $scriptPath)) {
    throw "Script not found: $scriptPath"
  }

  & powershell -ExecutionPolicy Bypass -File $scriptPath @Arguments
}

function Read-LocalConfig {
  if (-not (Test-Path $ConfigPath)) {
    return $null
  }

  try {
    return Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  } catch {
    Write-Host "Local config exists but could not be parsed: $($_.Exception.Message)" -ForegroundColor Red
    return $null
  }
}

function Get-ConfiguredRoots {
  $config = Read-LocalConfig
  if ($config -and $config.PSObject.Properties.Name -contains "allowedRoots") {
    return @($config.allowedRoots)
  }

  return @($SuggestedRoots)
}

function Get-AuditLogPath {
  $config = Read-LocalConfig
  if ($config -and $config.PSObject.Properties.Name -contains "auditLog" -and $config.auditLog) {
    return [string]$config.auditLog
  }

  return (Join-Path $LogsDir "audit.log")
}

function Test-RootOutsideProjects {
  param([string]$Root)
  return -not ($Root.ToLowerInvariant().StartsWith($ProjectsRoot.ToLowerInvariant()))
}

function Test-ServerRunning {
  if (-not (Test-Path $PidFile)) {
    return $false
  }

  $rawProcessId = (Get-Content -LiteralPath $PidFile -Raw).Trim()
  if (-not ($rawProcessId -match '^\d+$')) {
    return $false
  }

  $targetProcessId = [int]$rawProcessId
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $targetProcessId" -ErrorAction SilentlyContinue
  if (-not $processInfo) {
    return $false
  }

  $commandLine = ([string]$processInfo.CommandLine).ToLowerInvariant()
  return ($commandLine.Contains($RepoRoot.ToLowerInvariant()) -or $commandLine.Contains($Entrypoint.ToLowerInvariant()))
}

function Show-ServerStatus {
  Write-Host "Server status"
  Write-Host "-------------"
  Write-Host "PID file present: $(Test-Path $PidFile)"

  if (Test-Path $PidFile) {
    $rawProcessId = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    Write-Host "PID file value: $rawProcessId"
    if ($rawProcessId -match '^\d+$') {
      $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$rawProcessId)" -ErrorAction SilentlyContinue
      Write-Host "Process running: $([bool]$processInfo)"
    } else {
      Write-Host "Process running: false"
    }
  } else {
    Write-Host "Process running: false"
  }

  if (Test-Path $StatusFile) {
    try {
      $status = Get-Content -LiteralPath $StatusFile -Raw | ConvertFrom-Json
      Write-Host "Entrypoint path: $($status.entrypoint)"
      Write-Host "StartedAt: $($status.startedAt)"
    } catch {
      Write-Host "Status file could not be parsed: $($_.Exception.Message)"
    }
  } else {
    Write-Host "Entrypoint path: $Entrypoint"
  }

  Write-Host "Allowed roots:"
  foreach ($root in (Get-ConfiguredRoots)) {
    Write-Host "  - $root"
  }
  Write-Host "Audit log path: $(Get-AuditLogPath)"
}

function Configure-AllowedRoots {
  New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

  $existingConfig = Read-LocalConfig
  if ($existingConfig -and $existingConfig.PSObject.Properties.Name -contains "allowedRoots") {
    $roots = New-Object System.Collections.Generic.List[string]
    foreach ($root in @($existingConfig.allowedRoots)) {
      [void]$roots.Add([string]$root)
    }
  } else {
    $roots = New-Object System.Collections.Generic.List[string]
    foreach ($root in $SuggestedRoots) {
      [void]$roots.Add($root)
    }
  }

  while ($true) {
    Clear-Host
    Write-Host "Configure allowed roots"
    Write-Host "-----------------------"
    if ($roots.Count -eq 0) {
      Write-Host "No allowed roots selected."
    } else {
      for ($i = 0; $i -lt $roots.Count; $i++) {
        $root = $roots[$i]
        $status = if (Test-Path $root) { "exists" } else { "missing" }
        $scope = if (Test-RootOutsideProjects $root) { "outside $ProjectsRoot" } else { "inside projects" }
        Write-Host ("{0}. {1} ({2}, {3})" -f ($i + 1), $root, $status, $scope)
      }
    }

    Write-Host ""
    Write-Host "A. Add root"
    Write-Host "R. Remove root"
    Write-Host "S. Save config"
    Write-Host "C. Cancel"
    $choice = (Read-Host "Choose").Trim().ToUpperInvariant()

    if ($choice -eq "A") {
      $newRoot = (Read-Host "Enter an absolute Windows path").Trim()
      if (-not $newRoot) {
        continue
      }
      if (-not (Test-Path $newRoot)) {
        Write-Host "That path does not exist. It was not added." -ForegroundColor Red
        Start-Sleep -Seconds 2
        continue
      }
      if (Test-RootOutsideProjects $newRoot) {
        $confirm = (Read-Host "This root is outside $ProjectsRoot. Accept it anyway? Type YES").Trim()
        if ($confirm -ne "YES") {
          Write-Host "Root was not added."
          Start-Sleep -Seconds 1
          continue
        }
      }
      if (-not $roots.Contains($newRoot)) {
        [void]$roots.Add($newRoot)
      }
      continue
    }

    if ($choice -eq "R") {
      $indexText = (Read-Host "Enter the number to remove").Trim()
      if ($indexText -match '^\d+$') {
        $index = [int]$indexText - 1
        if ($index -ge 0 -and $index -lt $roots.Count) {
          $roots.RemoveAt($index)
        }
      }
      continue
    }

    if ($choice -eq "C") {
      Write-Host "Configuration canceled."
      return
    }

    if ($choice -eq "S") {
      if ($roots.Count -eq 0) {
        Write-Host "At least one allowed root is required." -ForegroundColor Red
        Start-Sleep -Seconds 2
        continue
      }

      $hasMissingRoot = $false
      foreach ($root in $roots) {
        if (-not (Test-Path $root)) {
          Write-Host "Missing root: $root" -ForegroundColor Red
          $hasMissingRoot = $true
        }
      }
      if ($hasMissingRoot) {
        Start-Sleep -Seconds 2
        continue
      }

      $allowedCommands = $DefaultAllowedCommands
      if ($existingConfig -and $existingConfig.PSObject.Properties.Name -contains "allowedCommands" -and $existingConfig.allowedCommands) {
        $allowedCommands = @($existingConfig.allowedCommands)
      }

      $localConfig = [ordered]@{
        allowedRoots = $roots.ToArray()
        requireGitRoot = $true
        auditLog = (Join-Path $LogsDir "audit.log")
        allowedCommands = @($allowedCommands)
      }
      $localConfig | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
      Write-Host "Wrote $ConfigPath"
      return
    }
  }
}

function Generate-ClientConfigs {
  $generatedDir = Join-Path $RepoRoot "generated"
  New-Item -ItemType Directory -Force -Path $generatedDir | Out-Null

  $roots = Get-ConfiguredRoots
  $allowedRootsEnv = ($roots -join ";")

  $generic = [ordered]@{
    mcpServers = [ordered]@{
      "champcity-gpt" = [ordered]@{
        command = "node"
        args = @($Entrypoint)
        cwd = $RepoRoot
        env = [ordered]@{
          CHAMPCITY_GPT_ALLOWED_ROOTS = $allowedRootsEnv
          CHAMPCITY_GPT_REQUIRE_GIT_ROOT = "true"
        }
      }
    }
  }

  $codex = [ordered]@{
    note = "Generic Codex local STDIO MCP example. Check your Codex docs for the exact config file location."
    mcpServers = $generic.mcpServers
  }

  $claude = [ordered]@{
    mcpServers = $generic.mcpServers
  }

  $generic | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $generatedDir "generic-stdio-mcp-config.example.json") -Encoding UTF8
  $codex | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $generatedDir "codex-mcp-config.example.json") -Encoding UTF8
  $claude | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $generatedDir "claude-desktop-mcp-config.example.json") -Encoding UTF8

  $chatgptNotes = @"
# ChatGPT Connection Notes

ChatGPT MCP or custom app support is product, plan, workspace, and rollout dependent. Check the current product documentation for the exact setup surface available to your account.

Codex local STDIO MCP is the safest first target for this local harness because the MCP server can be launched as a local Node.js process without opening a network listener.

Do not expose this local server publicly or forward it to the LAN or internet. This launcher starts only the existing stdio server entrypoint:

$Entrypoint

A hosted model or client that reads files through MCP may receive those file contents in its tool-call and model context. This setup does not make hosted ChatGPT fully local-only.

Use narrow allowed roots, review tool calls, and keep secrets out of configured project folders.
"@
  Set-Content -LiteralPath (Join-Path $generatedDir "chatgpt-connection-notes.md") -Value $chatgptNotes -Encoding UTF8

  Write-Host "Generated client config examples in $generatedDir"
}

function Open-AuditLog {
  $auditLog = Get-AuditLogPath
  if (Test-Path $auditLog) {
    Invoke-Item -LiteralPath $auditLog
    return
  }

  if (Test-Path $LogsDir) {
    Write-Host "No audit log has been created yet. Opening the logs folder."
    Invoke-Item -LiteralPath $LogsDir
  } else {
    Write-Host "No audit log has been created yet, and the logs folder does not exist."
  }
}

function Open-SetupDocs {
  $launcherDoc = Join-Path $RepoRoot "docs\LAUNCHER_SETUP.md"
  $chatgptDoc = Join-Path $RepoRoot "docs\CHATGPT_CONNECTION_GUIDE.md"

  if (Test-Path $launcherDoc) {
    Invoke-Item -LiteralPath $launcherDoc
  } else {
    Write-Host "Launcher setup docs were not found: $launcherDoc"
  }

  if (Test-Path $chatgptDoc) {
    $openChatGpt = (Read-Host "Open CHATGPT_CONNECTION_GUIDE.md too? Y/N").Trim().ToUpperInvariant()
    if ($openChatGpt -eq "Y") {
      Invoke-Item -LiteralPath $chatgptDoc
    }
  }
}

Set-Location $RepoRoot

while ($true) {
  Clear-Host
  Write-Host "ChampCity GPT MCP Launcher"
  Write-Host "==========================="
  Write-Host "Repo: $RepoRoot"
  Write-Host ""
  Write-Host "1. Run doctor check"
  Write-Host "2. Configure allowed roots"
  Write-Host "3. Build server"
  Write-Host "4. Start MCP server"
  Write-Host "5. Stop MCP server"
  Write-Host "6. Show MCP server status"
  Write-Host "7. Open audit log"
  Write-Host "8. Generate MCP client config"
  Write-Host "9. Open setup docs"
  Write-Host "0. Exit"
  Write-Host ""

  $choice = (Read-Host "Select an option").Trim()

  try {
    switch ($choice) {
      "1" {
        Invoke-LauncherScript "doctor.ps1"
        Pause-Launcher
      }
      "2" {
        Configure-AllowedRoots
        Pause-Launcher
      }
      "3" {
        & npm run build
        Pause-Launcher
      }
      "4" {
        if (Test-ServerRunning) {
          Write-Host "A launcher-started MCP server already appears to be running. Not starting a duplicate." -ForegroundColor Yellow
        } else {
          Invoke-LauncherScript "start-mcp.ps1" @("-Background")
        }
        Pause-Launcher
      }
      "5" {
        Invoke-LauncherScript "stop-mcp.ps1"
        Pause-Launcher
      }
      "6" {
        Show-ServerStatus
        Pause-Launcher
      }
      "7" {
        Open-AuditLog
        Pause-Launcher
      }
      "8" {
        Generate-ClientConfigs
        Pause-Launcher
      }
      "9" {
        Open-SetupDocs
        Pause-Launcher
      }
      "0" {
        exit 0
      }
      default {
        Write-Host "Unknown option: $choice" -ForegroundColor Yellow
        Pause-Launcher
      }
    }
  } catch {
    Write-Host ""
    Write-Host "Operation failed: $($_.Exception.Message)" -ForegroundColor Red
    Pause-Launcher
  }
}
