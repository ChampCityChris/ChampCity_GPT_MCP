param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$repoRoot = Resolve-RepoRoot
$launcherPath = Join-Path $repoRoot "scripts\champcity-gpt-launcher.ps1"

if (-not (Test-Path $launcherPath)) {
  throw "Launcher script was not found: $launcherPath"
}

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "ChampCity GPT MCP Launcher.lnk"
$powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellPath
$shortcut.Arguments = "-ExecutionPolicy Bypass -NoExit -File `"$launcherPath`""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.Description = "ChampCity GPT MCP Launcher"
$shortcut.Save()

Write-Host "Desktop shortcut created or updated:"
Write-Host $shortcutPath
