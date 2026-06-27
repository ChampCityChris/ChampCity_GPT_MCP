param(
  [string]$BaseUrl = "https://mcp.example.com",
  [string]$Token,
  [switch]$SkipMcp
)

$ErrorActionPreference = "Stop"
$failed = $false

function Write-Check {
  param(
    [ValidateSet("PASS", "WARN", "FAIL")]
    [string]$Status,
    [string]$Message
  )

  Write-Host "$Status $Message"
  if ($Status -eq "FAIL") {
    $script:failed = $true
  }
}

function Join-Endpoint {
  param([string]$Base, [string]$Path)
  return "$($Base.TrimEnd('/'))$Path"
}

function Invoke-McpPost {
  param(
    [string]$Url,
    [hashtable]$Body,
    [hashtable]$Headers
  )

  $json = $Body | ConvertTo-Json -Depth 20 -Compress
  return Invoke-WebRequest -Uri $Url -Method Post -Headers $Headers -Body $json -ContentType "application/json" -UseBasicParsing
}

function Get-McpMessages {
  param($Response)

  if ($Response.StatusCode -eq 202 -or [string]::IsNullOrWhiteSpace($Response.Content)) {
    return @()
  }

  $contentType = [string]$Response.Headers["Content-Type"]
  if ($contentType -notmatch "text/event-stream") {
    return @(($Response.Content | ConvertFrom-Json))
  }

  $messages = @()
  foreach ($line in ($Response.Content -split "`r?`n")) {
    if ($line.StartsWith("data:")) {
      $data = $line.Substring(5).Trim()
      if ($data) {
        $messages += ($data | ConvertFrom-Json)
      }
    }
  }
  return $messages
}

function Get-McpResult {
  param($Messages, [int]$Id)

  foreach ($message in $Messages) {
    if ($message.id -eq $Id) {
      if ($message.error) {
        throw "MCP request $Id returned error: $($message.error.message)"
      }
      return $message.result
    }
  }
  throw "MCP response for request $Id was not found."
}

$healthUrl = Join-Endpoint $BaseUrl "/health"
$mcpUrl = Join-Endpoint $BaseUrl "/mcp"

Write-Host "Verifying public ChampCity_GPT endpoint at $BaseUrl"

try {
  $health = Invoke-WebRequest -Uri $healthUrl -Method Get -UseBasicParsing
  if ($health.StatusCode -eq 200) {
    $healthJson = $health.Content | ConvertFrom-Json
    if ($healthJson.status -eq "ok") {
      Write-Check "PASS" "GET /health returned status ok."
    } else {
      Write-Check "FAIL" "GET /health returned HTTP 200 but status was not ok."
    }
  } else {
    Write-Check "FAIL" "GET /health returned HTTP $($health.StatusCode)."
  }
} catch {
  Write-Check "FAIL" "GET /health failed: $($_.Exception.Message)"
}

if (-not $SkipMcp) {
  $baseHeaders = @{
    "Accept" = "application/json, text/event-stream"
    "Mcp-Protocol-Version" = "2025-06-18"
  }

  $initializeBody = @{
    jsonrpc = "2.0"
    id = 1
    method = "initialize"
    params = @{
      protocolVersion = "2025-06-18"
      capabilities = @{}
      clientInfo = @{
        name = "champcity-public-endpoint-verifier"
        version = "0.0.0"
      }
    }
  }

  try {
    Invoke-McpPost -Url $mcpUrl -Body $initializeBody -Headers $baseHeaders | Out-Null
    Write-Check "FAIL" "POST /mcp without Authorization was accepted. Auth is expected for the public endpoint."
  } catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 401 -or $statusCode -eq 403) {
      Write-Check "PASS" "POST /mcp without Authorization was rejected."
    } else {
      Write-Check "FAIL" "POST /mcp without Authorization failed with unexpected status $statusCode."
    }
  }

  if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Check "WARN" "No token provided; skipped authenticated MCP initialize and tools/list."
  } else {
    $authHeaders = $baseHeaders.Clone()
    $authHeaders["Authorization"] = "Bearer $Token"

    try {
      $initialize = Invoke-McpPost -Url $mcpUrl -Body $initializeBody -Headers $authHeaders
      $messages = Get-McpMessages $initialize
      Get-McpResult -Messages $messages -Id 1 | Out-Null
      $sessionId = $initialize.Headers["mcp-session-id"]
      if ([string]::IsNullOrWhiteSpace($sessionId)) {
        throw "Initialize response did not include mcp-session-id."
      }
      Write-Check "PASS" "Authenticated MCP initialize succeeded."

      $sessionHeaders = $authHeaders.Clone()
      $sessionHeaders["mcp-session-id"] = $sessionId

      $initializedBody = @{
        jsonrpc = "2.0"
        method = "notifications/initialized"
      }
      $initialized = Invoke-McpPost -Url $mcpUrl -Body $initializedBody -Headers $sessionHeaders
      if ($initialized.StatusCode -eq 202 -or $initialized.StatusCode -eq 200) {
        Write-Check "PASS" "MCP notifications/initialized completed."
      } else {
        Write-Check "WARN" "MCP notifications/initialized returned HTTP $($initialized.StatusCode)."
      }

      $toolsBody = @{
        jsonrpc = "2.0"
        id = 2
        method = "tools/list"
      }
      $tools = Invoke-McpPost -Url $mcpUrl -Body $toolsBody -Headers $sessionHeaders
      $toolMessages = Get-McpMessages $tools
      $toolsResult = Get-McpResult -Messages $toolMessages -Id 2
      $toolNames = @($toolsResult.tools | ForEach-Object { $_.name })
      Write-Check "PASS" "Authenticated tools/list succeeded."
      Write-Host "Tools:"
      foreach ($name in $toolNames) {
        Write-Host "  - $name"
      }
    } catch {
      Write-Check "FAIL" "Authenticated MCP verification failed: $($_.Exception.Message)"
    }
  }
} else {
  Write-Check "WARN" "Skipped MCP checks because -SkipMcp was provided."
}

if ($failed) {
  exit 1
}

exit 0
