param([switch]$DebugBuild)
$ErrorActionPreference = 'Stop'
if ($env:CARGO_HOME) { $env:PATH = "$env:CARGO_HOME\bin;" + $env:PATH }
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
    if ($DebugBuild) { & npm.cmd run tauri -- build --debug --config src-tauri/tauri.dev.json } else { & npm.cmd run dist }
    if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed' }
} finally { Pop-Location }
