param(
  [switch]$SkipBuild,
  [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:FailCount = 0
$script:WarnCount = 0

function Resolve-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Write-Check {
  param(
    [ValidateSet("PASS", "WARN", "FAIL")]
    [string]$Level,
    [string]$Message
  )

  if ($Level -eq "FAIL") {
    $script:FailCount += 1
  }
  if ($Level -eq "WARN") {
    $script:WarnCount += 1
  }

  if ($Quiet -and $Level -eq "PASS") {
    return
  }

  $color = "Gray"
  if ($Level -eq "PASS") { $color = "Green" }
  if ($Level -eq "WARN") { $color = "Yellow" }
  if ($Level -eq "FAIL") { $color = "Red" }
  Write-Host ("{0} {1}" -f $Level, $Message) -ForegroundColor $color
}

function Test-CommandAvailable {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-WindowsAbsolutePath {
  param([string]$Value)
  return [bool]($Value -match '^[A-Za-z]:\\' -or $Value -match '^\\\\')
}

function Get-StatusInfo {
  param([string]$RepoRoot)
  $logsDir = Join-Path $RepoRoot "logs"
  $pidFile = Join-Path $logsDir "champcity-gpt-mcp.pid"
  $statusFile = Join-Path $logsDir "champcity-gpt-mcp.status.json"

  if (-not (Test-Path $pidFile)) {
    return "No launcher PID file present."
  }

  $rawProcessId = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  if (-not ($rawProcessId -match '^\d+$')) {
    return "PID file is present but invalid: $pidFile"
  }

  $targetProcessId = [int]$rawProcessId
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $targetProcessId" -ErrorAction SilentlyContinue
  if (-not $processInfo) {
    return "Stale PID file for PID $targetProcessId."
  }

  $startedAt = ""
  if (Test-Path $statusFile) {
    try {
      $status = Get-Content -LiteralPath $statusFile -Raw | ConvertFrom-Json
      if ($status.startedAt) {
        $startedAt = " StartedAt: $($status.startedAt)."
      }
    } catch {
      $startedAt = " Status JSON could not be parsed."
    }
  }

  return "PID $targetProcessId is running.$startedAt"
}

$repoRoot = Resolve-RepoRoot
$projectsRoot = Split-Path -Parent $repoRoot
$packageJson = Join-Path $repoRoot "package.json"
$nodeModules = Join-Path $repoRoot "node_modules"
$entrypoint = Join-Path $repoRoot "dist\src\index.js"
$configPath = Join-Path $repoRoot "config\allowed-roots.local.json"
$logsDir = Join-Path $repoRoot "logs"

Write-Host "ChampCity_GPT MCP Doctor"
Write-Host "Repo root: $repoRoot"
Write-Host ""

if (Test-Path $packageJson) {
  Write-Check "PASS" "Repo root resolved correctly and package.json exists."
} else {
  Write-Check "FAIL" "package.json was not found at $packageJson."
}

if (Test-CommandAvailable "node") {
  $nodeVersion = (& node --version)
  Write-Check "PASS" "Node.js is installed: $nodeVersion."
} else {
  Write-Check "FAIL" "Node.js is not installed or is not on PATH."
}

if (Test-CommandAvailable "npm") {
  $npmVersion = (& npm --version)
  Write-Check "PASS" "npm is installed: $npmVersion."
} else {
  Write-Check "FAIL" "npm is not installed or is not on PATH."
}

if (Test-Path $nodeModules) {
  Write-Check "PASS" "node_modules exists."
} elseif (Test-Path (Join-Path $repoRoot "package-lock.json")) {
  Write-Check "WARN" "node_modules is missing. The launcher can run npm install."
} else {
  Write-Check "WARN" "node_modules is missing and no package-lock.json was found."
}

if (Test-Path $configPath) {
  Write-Check "PASS" "Local config exists: $configPath."
  try {
    $localConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $propertyNames = @($localConfig.PSObject.Properties.Name)

    if ($propertyNames -contains "allowedRoots" -and $localConfig.allowedRoots -is [array]) {
      Write-Check "PASS" "allowedRoots is an array."
      foreach ($root in $localConfig.allowedRoots) {
        if (-not ($root -is [string])) {
          Write-Check "FAIL" "allowedRoots contains a non-string value."
          continue
        }
        if (Test-WindowsAbsolutePath $root) {
          Write-Check "PASS" "Allowed root is absolute: $root."
        } else {
          Write-Check "FAIL" "Allowed root is not an absolute Windows path: $root."
        }
        if (Test-Path $root) {
          Write-Check "PASS" "Allowed root exists: $root."
        } else {
          Write-Check "FAIL" "Allowed root does not exist: $root."
        }
        if ($root.ToLowerInvariant().StartsWith($projectsRoot.ToLowerInvariant())) {
          Write-Check "PASS" "Allowed root is under $projectsRoot: $root."
        } else {
          Write-Check "WARN" "Allowed root is outside $projectsRoot: $root."
        }
      }
    } else {
      Write-Check "FAIL" "allowedRoots must exist and be an array."
    }

    if ($propertyNames -contains "requireGitRoot") {
      if ($localConfig.requireGitRoot -is [bool]) {
        Write-Check "PASS" "requireGitRoot is boolean."
      } else {
        Write-Check "FAIL" "requireGitRoot must be boolean when present."
      }
    }

    if ($propertyNames -contains "auditLog") {
      if (($localConfig.auditLog -is [string]) -and (Test-WindowsAbsolutePath $localConfig.auditLog)) {
        Write-Check "PASS" "auditLog is an absolute path."
      } else {
        Write-Check "FAIL" "auditLog must be an absolute Windows path when present."
      }
    }

    if ($propertyNames -contains "allowedCommands") {
      if ($localConfig.allowedCommands -is [array]) {
        Write-Check "PASS" "allowedCommands is an array."
      } else {
        Write-Check "FAIL" "allowedCommands must be an array when present."
      }
    }
  } catch {
    Write-Check "FAIL" "Local config JSON is invalid: $($_.Exception.Message)"
  }
} else {
  Write-Check "WARN" "Local config is missing. Run launcher option 2 to create config\allowed-roots.local.json."
}

try {
  New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
  Write-Check "PASS" "logs directory exists or can be created: $logsDir."
} catch {
  Write-Check "FAIL" "logs directory cannot be created: $($_.Exception.Message)"
}

$staleRefs = @()
$pathsToScan = @("README.md", "docs", "examples", "package.json")
foreach ($scanPath in $pathsToScan) {
  $fullPath = Join-Path $repoRoot $scanPath
  if (-not (Test-Path $fullPath)) {
    continue
  }

  $files = @()
  if ((Get-Item $fullPath).PSIsContainer) {
    $files = Get-ChildItem -LiteralPath $fullPath -File -Recurse
  } else {
    $files = @(Get-Item $fullPath)
  }

  foreach ($file in $files) {
    $matches = Select-String -LiteralPath $file.FullName -SimpleMatch -Pattern ("dist" + "/index.js"), ("dist" + "\index.js") -ErrorAction SilentlyContinue
    foreach ($match in $matches) {
      if ($match.Line -notmatch "old top-level") {
        $staleRefs += "$($file.FullName):$($match.LineNumber)"
      }
    }
  }
}

if ($staleRefs.Count -eq 0) {
  Write-Check "PASS" "No stale server entrypoint references found in README, docs, examples, or package config."
} else {
  Write-Check "FAIL" "Stale server entrypoint references found: $($staleRefs -join ', ')."
}

if ($SkipBuild) {
  Write-Check "WARN" "Skipping npm run build because -SkipBuild was provided."
} else {
  try {
    Push-Location $repoRoot
    & npm run build
    if ($LASTEXITCODE -eq 0) {
      Write-Check "PASS" "npm run build passed."
    } else {
      Write-Check "FAIL" "npm run build failed with exit code $LASTEXITCODE."
    }
  } catch {
    Write-Check "FAIL" "npm run build could not run: $($_.Exception.Message)"
  } finally {
    Pop-Location
  }
}

if (Test-Path $entrypoint) {
  Write-Check "PASS" "MCP server entrypoint exists: $entrypoint."

  $probeOut = Join-Path $logsDir "doctor-entrypoint-probe.out.log"
  $probeErr = Join-Path $logsDir "doctor-entrypoint-probe.err.log"
  try {
    $probe = Start-Process -FilePath "node" `
      -ArgumentList @($entrypoint) `
      -WorkingDirectory $repoRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $probeOut `
      -RedirectStandardError $probeErr `
      -PassThru
    Start-Sleep -Milliseconds 750
    if ($probe.HasExited -and $probe.ExitCode -ne 0) {
      $errorText = ""
      if (Test-Path $probeErr) {
        $rawErrorText = Get-Content -LiteralPath $probeErr -Raw
        if ($null -ne $rawErrorText) {
          $errorText = $rawErrorText.Trim()
        }
      }
      $probeExitCode = if ($null -eq $probe.ExitCode) { "unknown" } else { [string]$probe.ExitCode }
      if ($errorText -match "Cannot find module|ERR_MODULE_NOT_FOUND|SyntaxError") {
        Write-Check "FAIL" "Entrypoint failed during startup probe. $errorText"
      } else {
        Write-Check "WARN" "Entrypoint exited quickly during the no-client stdio probe with code $probeExitCode, but no module-loading failure was reported."
      }
    } else {
      Write-Check "PASS" "Entrypoint startup probe did not hit a module-loading failure."
    }
    if (-not $probe.HasExited) {
      Stop-Process -Id $probe.Id -Force -ErrorAction SilentlyContinue
    }
  } catch {
    Write-Check "FAIL" "Entrypoint startup probe could not run: $($_.Exception.Message)"
  } finally {
    Remove-Item -LiteralPath $probeOut -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $probeErr -Force -ErrorAction SilentlyContinue
  }
} else {
  Write-Check "FAIL" "MCP server entrypoint is missing: $entrypoint."
}

Write-Host ""
Write-Host "Current server status: $(Get-StatusInfo $repoRoot)"
Write-Host "Doctor complete: $script:FailCount fail(s), $script:WarnCount warning(s)."

if ($script:FailCount -gt 0) {
  exit 1
}

exit 0
