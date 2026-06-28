$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$failures = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Add-Failure([string]$Message) {
  [void]$failures.Add($Message)
}

function Get-GitList([string[]]$GitArgs) {
  try {
    $output = & git @GitArgs 2>$null
    if ($LASTEXITCODE -ne 0) {
      return @()
    }
    return @($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  } catch {
    return @()
  }
}

$candidateFiles = Get-GitList -GitArgs @("ls-files", "--cached", "--others", "--exclude-standard")
$stagedFiles = Get-GitList -GitArgs @("diff", "--cached", "--name-only")
$trackedFiles = Get-GitList -GitArgs @("ls-files")

$blockedPathPatterns = @(
  '^config/.*\.local\.json$',
  '^handoffs/.*\.zip$',
  '^handoffs/figma-ui-context/',
  '^handoffs/figma-make-launcher-ui/',
  '^handoffs/figma-mcp-launcher-ui-v2/',
  '^logs/',
  '^generated/',
  '^release/',
  '^dist/',
  '^node_modules/',
  '^package-lock\.zip$',
  '\.log$',
  '\.pid$',
  '\.status\.json$',
  '\.tsbuildinfo$'
)

$privateGeneratedPathPatterns = @(
  '^handoffs/figma-ui-context/',
  '^handoffs/figma-make-launcher-ui/',
  '^handoffs/figma-mcp-launcher-ui-v2/'
)

foreach ($file in ($trackedFiles + $stagedFiles | Select-Object -Unique)) {
  $normalized = $file -replace '\\', '/'
  foreach ($pattern in $blockedPathPatterns) {
    if ($normalized -match $pattern) {
      Add-Failure "Tracked/staged local artifact is not publishable: $file"
      break
    }
  }
}

$privatePatterns = @(
  ('C:\\Users\\' + 'cha' + 'pm'),
  ('\b' + 'cha' + 'pm' + '\b'),
  ('chris\.b\.' + 'chap' + 'man'),
  ('mcp\.' + 'champ' + 'city\.net'),
  ('champ' + 'city\.net')
)

$scanExtensions = '\.(md|json|yml|yaml|ps1|ts|js|html|css|txt|example)$'
$scanFiles = $candidateFiles | Where-Object {
  $normalized = $_ -replace '\\', '/'
  $isPrivateGeneratedPath = $false
  foreach ($pattern in $privateGeneratedPathPatterns) {
    if ($normalized -match $pattern) {
      $isPrivateGeneratedPath = $true
      break
    }
  }
  -not $isPrivateGeneratedPath -and
  $normalized -notmatch '^node_modules/' -and
  $normalized -notmatch '^dist/' -and
  $normalized -notmatch '^release/' -and
  $normalized -notmatch '^logs/' -and
  $normalized -notmatch '^generated/' -and
  $normalized -notmatch '^package-lock\.json$' -and
  ($_ -match $scanExtensions -or $normalized -match '(^|/)(README|SECURITY|CONTRIBUTING|\.env\.example|electron-builder\.json|package\.json|\.gitignore)$')
}

foreach ($file in $scanFiles) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    continue
  }
  $content = Get-Content -LiteralPath $file -Raw
  foreach ($pattern in $privatePatterns) {
    if ($content -match $pattern) {
      Add-Failure "Private value matched '$pattern' in $file"
    }
  }
}

$tokenFilePatterns = @('^config/', '^docs/', '^examples/', '^README\.md$', '^\.env\.example$')
$tokenRegexes = @(
  '(?i)(token|secret|client_secret|refresh_token|access_token|api[_-]?key)["'']?\s*[:=]\s*["''][A-Za-z0-9_\-\.]{24,}["'']',
  'figmaAccessToken["'']?\s*:\s*["''](?!<FIGMA_ACCESS_TOKEN>)[A-Za-z0-9_\-\.]{24,}["'']',
  'figd_[A-Za-z0-9_\-]{20,}',
  '(?i)bearer\s+[A-Za-z0-9_\-\.]{24,}',
  'eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}'
)

foreach ($file in $scanFiles) {
  $normalized = $file -replace '\\', '/'
  $isTokenScanFile = $false
  foreach ($pattern in $tokenFilePatterns) {
    if ($normalized -match $pattern) {
      $isTokenScanFile = $true
      break
    }
  }
  if (-not $isTokenScanFile -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
    continue
  }
  $content = Get-Content -LiteralPath $file -Raw
  foreach ($pattern in $tokenRegexes) {
    if ($content -match $pattern) {
      Add-Failure "Token-looking value matched in $file"
    }
  }
}

if (($stagedFiles | Where-Object { ($_ -replace '\\', '/') -match '^config/.*\.local\.json$' }).Count -gt 0) {
  Add-Failure "config/*.local.json is staged."
}

if ($candidateFiles.Count -eq 0) {
  [void]$warnings.Add("No Git candidate files found. Is this a fresh repository with nothing staged or tracked?")
}

if ($failures.Count -gt 0) {
  Write-Host "FAIL publication cleanliness"
  foreach ($failure in $failures) {
    Write-Host "FAIL $failure"
  }
  exit 1
}

Write-Host "PASS publication cleanliness"
foreach ($warning in $warnings) {
  Write-Host "WARN $warning"
}
Write-Host "Checked $($scanFiles.Count) source candidate files."
