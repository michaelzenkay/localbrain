$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

Write-Host "Restricting LocalBrain files to $Identity, SYSTEM, and Administrators..."
icacls $Root /inheritance:r | Out-Null
icacls $Root /grant:r "${Identity}:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" | Out-Null

Get-ChildItem -LiteralPath $Root -Force | ForEach-Object {
  icacls $_.FullName /reset /T /C /Q | Out-Null
}

Write-Host "LocalBrain repository ACLs hardened."
