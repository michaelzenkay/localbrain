#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$RuleName = "LocalBrain - Block inbound TCP ports"

Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue |
  Remove-NetFirewallRule

New-NetFirewallRule `
  -DisplayName $RuleName `
  -Direction Inbound `
  -Action Block `
  -Protocol TCP `
  -LocalPort "11434,54320-54329" `
  -Profile Any | Out-Null

Write-Host "Installed firewall rule: $RuleName"
