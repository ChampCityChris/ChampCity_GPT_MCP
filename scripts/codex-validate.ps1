param(
  [ValidateSet("unit", "build", "full")]
  [string]$Suite = "full"
)

$ErrorActionPreference = "Stop"

Write-Host "ChampCity_GPT validation runner"
Write-Host "Required lane: normal Windows execution"
Write-Host "Suite: $Suite"

if (-not (Test-Path "package.json")) {
  throw "package.json not found. Run this from the repository root."
}

$pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
$scripts = $pkg.scripts

function Test-NpmScript {
  param([string]$Name)
  return $null -ne $scripts.PSObject.Properties[$Name]
}

function Invoke-NpmScript {
  param([string]$Name)

  if (-not (Test-NpmScript $Name)) {
    throw "Required npm script '$Name' is missing from package.json."
  }

  Write-Host "Running: npm run $Name"
  & npm run $Name

  if ($LASTEXITCODE -ne 0) {
    throw "npm run $Name failed with exit code $LASTEXITCODE."
  }
}

function Invoke-FirstAvailableScript {
  param(
    [string[]]$Names,
    [string]$Purpose
  )

  foreach ($name in $Names) {
    if (Test-NpmScript $name) {
      Invoke-NpmScript $name
      return
    }
  }

  throw "No npm script found for $Purpose. Checked: $($Names -join ', ')"
}

switch ($Suite) {
  "unit" {
    Invoke-FirstAvailableScript -Names @("test:unit", "test", "vitest") -Purpose "unit validation"
    break
  }
  "build" {
    Invoke-FirstAvailableScript -Names @("build", "typecheck", "compile") -Purpose "build validation"
    break
  }
  "full" {
    Invoke-FirstAvailableScript -Names @("test:unit", "test", "vitest") -Purpose "unit validation"
    Invoke-FirstAvailableScript -Names @("build", "typecheck", "compile") -Purpose "build validation"
    break
  }
}
