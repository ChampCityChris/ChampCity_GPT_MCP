param(
  [string]$RepositoryRoot = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
  $repoRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
}
$releaseRoot = Join-Path $repoRoot "release"
$distSrcRoot = Join-Path $repoRoot "dist\src"
$failures = New-Object System.Collections.Generic.List[string]

function Add-Failure([string]$Message) {
  [void]$failures.Add($Message)
}

function Get-RelativePath([string]$Root, [string]$FullName) {
  return $FullName.Substring($Root.Length).TrimStart('\', '/')
}

$retiredProductionPatterns = @(
  '(^|[\\/])saveArchitectInterviewOutput\.(js|js\.map|d\.ts|mjs|cjs)$',
  '(^|[\\/])saveProjectPlanningOutputs\.(js|js\.map|d\.ts|mjs|cjs)$'
)

if (Test-Path -LiteralPath $distSrcRoot) {
  $distSrcFiles = Get-ChildItem -LiteralPath $distSrcRoot -Recurse -Force -File
  foreach ($file in $distSrcFiles) {
    $relative = Get-RelativePath $distSrcRoot $file.FullName
    foreach ($pattern in $retiredProductionPatterns) {
      if ($relative -match $pattern) {
        Add-Failure "Retired compiled production module found in package input: dist/src/$($relative -replace '\\', '/')"
        break
      }
    }
  }
}

$blockedFilePatterns = @(
  'config[\\/].*\.local\.json$',
  'oauth-tokens\.local\.json$',
  'http-auth\.local\.json$',
  'allowed-roots\.local\.json$',
  'write-access\.local\.json$',
  'package-lock\.zip$',
  '\.log$',
  '\.pid$',
  '\.status\.json$'
)

$blockedDirPatterns = @(
  '[\\/]logs$',
  '[\\/]generated$'
)

$files = @()
$dirs = @()
if (Test-Path -LiteralPath $releaseRoot) {
  $files = Get-ChildItem -LiteralPath $releaseRoot -Recurse -Force -File
  $dirs = Get-ChildItem -LiteralPath $releaseRoot -Recurse -Force -Directory
}

foreach ($file in $files) {
  $relative = Get-RelativePath $releaseRoot $file.FullName
  foreach ($pattern in $blockedFilePatterns) {
    if ($relative -match $pattern) {
      Add-Failure "Blocked local file found in release output: $relative"
      break
    }
  }
}

foreach ($dir in $dirs) {
  $relative = Get-RelativePath $releaseRoot $dir.FullName
  foreach ($pattern in $blockedDirPatterns) {
    if ($relative -match $pattern) {
      Add-Failure "Blocked local directory found in release output: $relative"
      break
    }
  }
}

$privatePatterns = @(
  ('C:\\Users\\' + 'cha' + 'pm'),
  ('mcp\.' + 'champ' + 'city\.net'),
  ('champ' + 'city\.net')
)

$textExtensions = '\.(txt|md|json|yml|yaml|js|html|css|ps1|map)$'
foreach ($file in ($files | Where-Object { $_.Name -match $textExtensions })) {
  $relative = Get-RelativePath $releaseRoot $file.FullName
  $content = Get-Content -LiteralPath $file.FullName -Raw
  foreach ($pattern in $privatePatterns) {
    if ($content -match $pattern) {
      Add-Failure "Private value matched '$pattern' in release file: $relative"
    }
  }
}

if ($failures.Count -gt 0) {
  Write-Host "FAIL release cleanliness"
  foreach ($failure in $failures) {
    Write-Host "FAIL $failure"
  }
  exit 1
}

Write-Host "PASS release cleanliness"
if (-not (Test-Path -LiteralPath $releaseRoot)) {
  Write-Host "WARN release/ does not exist; run npm run app:dist before checking release artifacts."
} else {
  Write-Host "Checked $($files.Count) release files."
}
