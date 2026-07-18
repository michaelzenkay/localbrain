$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$EnvPath = Join-Path $Root ".env"
$DockerNetwork = "localbrain-loopback"
$FirewallRuleName = "LocalBrain - Block inbound TCP ports"

if (!(Test-Path $EnvPath)) {
  throw "Missing .env. Copy .env.example to .env and set MCP_ACCESS_KEY first."
}

$FirewallRule = Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue
if (!$FirewallRule -or $FirewallRule.Enabled -ne "True" -or $FirewallRule.Action -ne "Block") {
  throw "Required firewall rule is missing. Open PowerShell as Administrator and run: powershell -NoProfile -File .\scripts\install-localbrain-firewall.ps1"
}

$ExistingNetwork = docker network ls --filter "name=^$DockerNetwork$" --format "{{.Name}}"
if ($ExistingNetwork -eq $DockerNetwork) {
  $Options = (docker network inspect $DockerNetwork --format "{{json .Options}}") | ConvertFrom-Json
  if ($Options.'com.docker.network.bridge.host_binding_ipv4' -ne "127.0.0.1") {
    throw "Docker network $DockerNetwork exists without loopback-only binding. Remove it while LocalBrain is stopped, then retry."
  }
} else {
  docker network create `
    --driver bridge `
    --opt "com.docker.network.bridge.host_binding_ipv4=127.0.0.1" `
    $DockerNetwork | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not create Docker network $DockerNetwork" }
}

Push-Location $Root
try {
  supabase start --network-id $DockerNetwork
  $ContainerIds = docker ps -aq --filter "label=com.supabase.cli.project=localbrain"
  if ($ContainerIds) { docker update --restart=no $ContainerIds | Out-Null }
  Write-Host "Start the MCP function in another terminal with:"
  Write-Host "supabase functions serve local-memory-mcp --network-id $DockerNetwork --env-file .env"
} finally {
  Pop-Location
}
