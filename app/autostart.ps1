# Autostart (run by the "Masters app" scheduled task at sign-in and on wake from sleep).
# Starts the app if it isn't running and opens VS Code on the workspace if it isn't open.
$root = Split-Path -Parent $PSScriptRoot
$app = $PSScriptRoot
$log = Join-Path $app ".local\autostart.log"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null

if (-not (Get-Process Code -ErrorAction SilentlyContinue)) {
    Start-Process "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" -ArgumentList "`"$root`""
}

$listening = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    Start-Process (Join-Path $app ".venv\Scripts\python.exe") `
        -ArgumentList "`"$app\start.py`" --once --no-browser" `
        -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput $log -RedirectStandardError "$log.err"
}
