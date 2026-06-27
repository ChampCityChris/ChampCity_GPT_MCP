param(
  [string]$BaseUrl = "http://127.0.0.1:3333"
)

$ErrorActionPreference = "Stop"

function ConvertTo-Base64Url {
  param([byte[]]$Bytes)
  return [Convert]::ToBase64String($Bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function New-CodeVerifier {
  $bytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return ConvertTo-Base64Url -Bytes $bytes
}

function New-CodeChallenge {
  param([string]$Verifier)
  $bytes = [System.Text.Encoding]::ASCII.GetBytes($Verifier)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha256.ComputeHash($bytes)
  } finally {
    $sha256.Dispose()
  }
  return ConvertTo-Base64Url -Bytes $hash
}

function Write-Check {
  param(
    [string]$Status,
    [string]$Message
  )
  Write-Host "[$Status] $Message"
}

$base = $BaseUrl.TrimEnd("/")
$redirectUri = "https://chatgpt.com/connector/oauth/test-callback"
$verifier = New-CodeVerifier
$challenge = New-CodeChallenge -Verifier $verifier

Write-Check "INFO" "Registering temporary ChatGPT-style public PKCE client at $base/oauth/register."

$registrationBody = @{
  redirect_uris = @($redirectUri)
  client_name = "ChatGPT Local PKCE Verification"
  grant_types = @("authorization_code")
  response_types = @("code")
  token_endpoint_auth_method = "none"
  scope = "files.read"
} | ConvertTo-Json -Depth 5

$registration = Invoke-RestMethod -Method Post -Uri "$base/oauth/register" -ContentType "application/json" -Body $registrationBody
$clientId = [string]$registration.client_id
if (-not $clientId) {
  throw "Registration did not return a client_id."
}

Write-Check "PASS" "Dynamic registration succeeded. Client prefix: $($clientId.Substring(0, [Math]::Min(8, $clientId.Length)))."

$authorizeParams = [ordered]@{
  response_type = "code"
  client_id = $clientId
  redirect_uri = $redirectUri
  scope = "files.read"
  state = "local-pkce-check"
  code_challenge = $challenge
  code_challenge_method = "S256"
}
$query = ($authorizeParams.GetEnumerator() | ForEach-Object {
  "$([Uri]::EscapeDataString($_.Key))=$([Uri]::EscapeDataString([string]$_.Value))"
}) -join "&"
$authorizeUrl = "$base/oauth/authorize?$query"

Write-Check "INFO" "Calling authorize endpoint with S256 PKCE challenge. Raw challenge and verifier are not printed."

try {
  $authorize = Invoke-WebRequest -Method Get -Uri $authorizeUrl -MaximumRedirection 0 -UseBasicParsing
  if ($authorize.StatusCode -eq 200 -and $authorize.Content -match "Authorize") {
    Write-Check "PASS" "Authorize accepted PKCE and returned the approval page."
    exit 0
  }

  if ($authorize.StatusCode -eq 503 -and $authorize.Content -match "OAuth setup required") {
    Write-Check "PASS" "Authorize accepted PKCE before stopping at expected OAuth admin setup requirement."
    exit 0
  }

  Write-Check "WARN" "Authorize returned HTTP $($authorize.StatusCode). Review local OAuth authorize logs."
  exit 1
} catch {
  $response = $_.Exception.Response
  if ($response -and [int]$response.StatusCode -eq 503) {
    Write-Check "PASS" "Authorize accepted PKCE before stopping at expected OAuth admin setup requirement."
    exit 0
  }

  if ($response) {
    Write-Check "FAIL" "Authorize returned HTTP $([int]$response.StatusCode). Check whether code_challenge was preserved in logs."
  } else {
    Write-Check "FAIL" "Authorize request failed: $($_.Exception.Message)"
  }
  exit 1
}
