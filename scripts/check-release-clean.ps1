$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseRoot = Join-Path $repoRoot "release"
$failures = New-Object System.Collections.Generic.List[string]

function Add-Failure([string]$Message) {
  [void]$failures.Add($Message)
}

if (-not (Test-Path -LiteralPath $releaseRoot)) {
  Write-Host "PASS release cleanliness"
  Write-Host "WARN release/ does not exist; run npm run app:dist before checking release artifacts."
  exit 0
}

$files = Get-ChildItem -LiteralPath $releaseRoot -Recurse -Force -File
$dirs = Get-ChildItem -LiteralPath $releaseRoot -Recurse -Force -Directory

function Get-RelativeReleasePath([string]$FullName) {
  return $FullName.Substring($releaseRoot.Length).TrimStart('\', '/')
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

foreach ($file in $files) {
  $relative = Get-RelativeReleasePath $file.FullName
  foreach ($pattern in $blockedFilePatterns) {
    if ($relative -match $pattern) {
      Add-Failure "Blocked local file found in release output: $relative"
      break
    }
  }
}

foreach ($dir in $dirs) {
  $relative = Get-RelativeReleasePath $dir.FullName
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
  $relative = Get-RelativeReleasePath $file.FullName
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
Write-Host "Checked $($files.Count) release files."
