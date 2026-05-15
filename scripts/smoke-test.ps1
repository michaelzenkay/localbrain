$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$EnvPath = Join-Path $Root ".env"

if (!(Test-Path $EnvPath)) {
  throw "Missing .env. Copy .env.example to .env and set MCP_ACCESS_KEY first."
}

function Read-EnvFile($Path) {
  $values = @{}
  Get-Content $Path | ForEach-Object {
    if ($_ -match '^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$') {
      $values[$matches[1]] = $matches[2].Trim('"').Trim("'")
    }
  }
  return $values
}

$EnvValues = Read-EnvFile $EnvPath
$Key = $Env:MCP_ACCESS_KEY
if (!$Key) { $Key = $EnvValues["MCP_ACCESS_KEY"] }
if (!$Key -or $Key -like "<*") { throw "Set MCP_ACCESS_KEY in .env before running the smoke test." }

$Endpoint = $Env:LOCALBRAIN_MCP_URL
if (!$Endpoint) { $Endpoint = $EnvValues["LOCALBRAIN_MCP_URL"] }
if (!$Endpoint) { $Endpoint = "http://127.0.0.1:54321/functions/v1/local-memory-mcp" }

$Headers = @{
  "content-type" = "application/json"
  "accept" = "application/json, text/event-stream"
  "x-brain-key" = $Key
}

function Invoke-Mcp($Id, $Method, $Params) {
  $Body = @{ jsonrpc = "2.0"; id = $Id; method = $Method; params = $Params } | ConvertTo-Json -Depth 10
  $Response = Invoke-WebRequest -Uri $Endpoint -Method Post -Headers $Headers -Body $Body
  if ($Response.Headers["mcp-session-id"]) {
    $Headers["mcp-session-id"] = $Response.Headers["mcp-session-id"]
  }
  return $Response.Content
}

Invoke-Mcp 1 "initialize" @{
  protocolVersion = "2024-11-05"
  capabilities = @{}
  clientInfo = @{ name = "localbrain-smoke-test"; version = "0.1.0" }
} | Out-Null

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Thought = "localbrain smoke test thought $Stamp"

Invoke-Mcp 2 "tools/call" @{ name = "capture_thought"; arguments = @{ content = $Thought; brain_id = "localbrain"; source_client = "smoke-test" } } | Out-Null
$Search = Invoke-Mcp 3 "tools/call" @{ name = "search_thoughts"; arguments = @{ query = $Thought; limit = 1; threshold = 0.1 } }
Invoke-Mcp 4 "tools/call" @{ name = "list_thoughts"; arguments = @{ limit = 3 } } | Out-Null
Invoke-Mcp 5 "tools/call" @{ name = "thought_stats"; arguments = @{} } | Out-Null
Invoke-Mcp 6 "tools/call" @{ name = "update_thought"; arguments = @{ target = $Thought; content = "$Thought updated"; source_client = "smoke-test" } } | Out-Null
Invoke-Mcp 7 "tools/call" @{ name = "delete_thought"; arguments = @{ target = "$Thought updated" } } | Out-Null

Write-Host "Smoke test completed."
Write-Host $Search
