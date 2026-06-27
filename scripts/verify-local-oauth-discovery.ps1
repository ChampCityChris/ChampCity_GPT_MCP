param(
  [string]$BaseUrl = "http://127.0.0.1:3333"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Join-Endpoint {
  param(
    [string]$Root,
    [string]$Path
  )

  return "$($Root.TrimEnd('/'))/$($Path.TrimStart('/'))"
}

function Write-Check {
  param(
    [ValidateSet("PASS", "FAIL")]
    [string]$Status,
    [string]$Message
  )

  Write-Host "$Status $Message"
}

$failures = 0

$metadataPaths = @(
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-authorization-server/mcp",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp"
)

foreach ($path in $metadataPaths) {
  $url = Join-Endpoint $BaseUrl $path
  try {
    $response = Invoke-WebRequest -Method Get -Uri $url -UseBasicParsing -TimeoutSec 10
    if ($response.StatusCode -eq 200 -and ($response.Headers["Content-Type"] -match "application/json")) {
      $null = $response.Content | ConvertFrom-Json
      Write-Check "PASS" "GET $path returned HTTP 200 JSON."
    } else {
      Write-Check "FAIL" "GET $path returned HTTP $($response.StatusCode) with Content-Type '$($response.Headers["Content-Type"])'."
      $failures++
    }
  } catch {
    Write-Check "FAIL" "GET $path failed: $($_.Exception.Message)"
    $failures++
  }
}

$registerUrl = Join-Endpoint $BaseUrl "/oauth/register"
$registerBody = @{
  redirect_uris = @("https://chatgpt.com/connector/oauth/test")
  client_name = "ChatGPT Test"
  grant_types = @("authorization_code")
  response_types = @("code")
  token_endpoint_auth_method = "none"
  scope = "files.read"
} | ConvertTo-Json -Depth 4

try {
  $response = Invoke-WebRequest -Method Post -Uri $registerUrl -ContentType "application/json" -Body $registerBody -UseBasicParsing -TimeoutSec 10
  $json = $response.Content | ConvertFrom-Json
  if ($response.StatusCode -eq 201 -and $json.client_id) {
    Write-Check "PASS" "POST /oauth/register returned HTTP 201 with client_id."
  } else {
    Write-Check "FAIL" "POST /oauth/register returned HTTP $($response.StatusCode) without client_id."
    $failures++
  }
} catch {
  Write-Check "FAIL" "POST /oauth/register failed: $($_.Exception.Message)"
  $failures++
}

if ($failures -gt 0) {
  Write-Host "$failures check(s) failed."
  exit 1
}

Write-Host "All local OAuth discovery checks passed."
exit 0
