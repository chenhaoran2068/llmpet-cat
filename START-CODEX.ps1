$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$runtime = Join-Path $HOME '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$node = Join-Path $runtime 'node\bin\node.exe'
$pnpm = Join-Path $runtime 'bin\fallback\pnpm.cmd'

if (-not (Test-Path $node)) {
  $node = (Get-Command node -ErrorAction Stop).Source
}

if (-not (Test-Path 'node_modules\electron\dist\electron.exe')) {
  if (Test-Path $pnpm) {
    & $pnpm install
  } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
    npm install
  } else {
    throw 'npm/pnpm was not found. Install Node.js 18 or newer.'
  }

  # Bundled pnpm may suppress dependency install scripts. Electron's installer
  # downloads the matching runtime binary when it is still missing.
  if (-not (Test-Path 'node_modules\electron\dist\electron.exe')) {
    & $node 'node_modules\electron\install.js'
  }
}

$env:OCTOPUS_NO_HOOKS = '1'
Start-Process -FilePath (Resolve-Path 'node_modules\electron\dist\electron.exe') `
  -ArgumentList '.' -WorkingDirectory $root
