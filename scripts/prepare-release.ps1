param([string]$Destination = 'D:\DSH-Publishing')
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    if (git status --porcelain) { throw 'Commit reviewed source changes before preparing a release.' }
    $revision = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Not a Git source repository' }
    $base = [IO.Path]::GetFullPath($Destination)
    if ($base -ne 'D:\DSH-Publishing') { throw 'This local release workflow only writes to D:\DSH-Publishing' }
    if ((Test-Path -LiteralPath $base) -and ((Get-Item -LiteralPath $base).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked destination refused' }
    $target = Join-Path $base ('source-' + $revision.Substring(0,12))
    if (Test-Path -LiteralPath $target) { throw 'Release source already exists; do not overwrite a reviewed build.' }
    $files = @(git ls-tree -r --name-only HEAD)
    foreach ($file in $files) {
        if ($file -match '(?i)(^|/)(node_modules|target|dist|release|offline-payload|test-results|\.env[^/]*|\.npmrc)(/|$)|\.(key|pem|pfx|exe|msi|vhdx|log|jsonl|zstd|sig)$|(^|/)ui-[^/]*\.png$') { throw "Unexpected release source file: $file" }
    }
    $links = @(git ls-tree -r HEAD | Where-Object { $_ -match '^(120000|160000) ' })
    if ($links.Count) { throw 'Symlinks and submodules require separate review' }
    $suspects = @(git grep -I -l -E 'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|BEGIN .*PRIVATE KEY' HEAD)
    if ($LASTEXITCODE -gt 1) { throw 'Credential scan failed' }
    if ($suspects.Count) { throw 'Possible credential found in committed source. Review locally; export refused.' }
    New-Item -ItemType Directory -Path $target | Out-Null
    $archive = Join-Path $target 'source.zip'
    git archive --format=zip --output=$archive HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Source export failed' }
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $target 'src')
    Write-Output "Prepared committed source only: $target"
    Write-Output 'No installer, private key, WSL export or personal data was copied. Do not run release executables on your daily environment.'
} finally { Pop-Location }
