# Starts the Audit Performance Platform (installs/builds on first run).
# Uses the portable Node 22 in your user folder if present, otherwise any Node 22.5+ on this PC.
param([int]$Port = 3000, [switch]$Rebuild)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$portable = Get-ChildItem "$env:USERPROFILE\node-portable" -Directory -Filter 'node-v22*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($portable) { $env:Path = "$($portable.FullName);$env:Path" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Node.js 22.5 or newer was not found. See README.md (Installation).'; exit 1 }
$v = [version]((node -v) -replace '^v', '')
if ($v -lt [version]'22.5.0') { Write-Host "Node $v is too old - version 22.5 or newer is required."; exit 1 }
if (-not (Test-Path node_modules)) { Write-Host 'Installing packages (first run only)...'; npm install --no-audit --no-fund; if ($LASTEXITCODE) { exit 1 } }
if ($Rebuild -or -not (Test-Path client\dist\index.html)) { Write-Host 'Building the web pages...'; npm run build; if ($LASTEXITCODE) { exit 1 } }
$env:PORT = $Port
Write-Host "Starting on http://localhost:$Port  (press Ctrl+C to stop)"
npm start
