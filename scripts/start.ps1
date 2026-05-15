$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$EnvPath = Join-Path $Root ".env"

if (!(Test-Path $EnvPath)) {
  throw "Missing .env. Copy .env.example to .env and set MCP_ACCESS_KEY first."
}

Push-Location $Root
try {
  supabase start
  Write-Host "Start the MCP function in another terminal with:"
  Write-Host "supabase functions serve local-memory-mcp --env-file .env"
} finally {
  Pop-Location
}
