# Starts the Masters app when the PC boots (before anyone logs in, so the phone can use it)
# and opens the workspace in VS Code when you log in.
# Run once in PowerShell as administrator:
#   powershell -ExecutionPolicy Bypass -File "<repo folder>\app\autostart\install.ps1"
# Undo with uninstall.ps1 in this folder.

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')           # the Masters folder
$App = Join-Path $Root 'app'
$Log = Join-Path $App '.local\autostart.log'
$Python = Join-Path $env:USERPROFILE 'anaconda3\python.exe'
$Code = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\Code.exe'
$User = "$env:USERDOMAIN\$env:USERNAME"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this from PowerShell opened with "Run as administrator".'
}
foreach ($p in $Python, $Code) { if (-not (Test-Path $p)) { throw "Not found: $p" } }
New-Item -ItemType Directory -Force (Split-Path $Log) | Out-Null

# --- 1. The app: at boot, at logon, and re-checked every 5 minutes (restarts it after a crash, and covers
#     Fast Startup boots, which skip "at startup" triggers). --once makes extra runs exit if it's already up.
$appAction = New-ScheduledTaskAction -Execute 'cmd.exe' `
    -Argument "/c `"`"$Python`" `"$App\start.py`" --no-browser --once >> `"$Log`" 2>&1`"" `
    -WorkingDirectory $Root
$appTriggers = @(
    New-ScheduledTaskTrigger -AtStartup
    New-ScheduledTaskTrigger -AtLogOn -User $User
    New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
)
# S4U = runs as you whether or not you're logged in, without storing your password.
$appPrincipal = New-ScheduledTaskPrincipal -UserId $User -LogonType S4U -RunLevel Limited
$appSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName 'Masters app' -Action $appAction -Trigger $appTriggers -Principal $appPrincipal `
    -Settings $appSettings -Description 'Masters application tracker (http://127.0.0.1:8000, also on the home network for the phone).' -Force | Out-Null

# --- 2. VS Code on the workspace, when you log in (at the PC or over Remote Desktop).
$codeAction = New-ScheduledTaskAction -Execute $Code -Argument "`"$Root`""
$codeTrigger = New-ScheduledTaskTrigger -AtLogOn -User $User
$codePrincipal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
$codeSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Masters VS Code' -Action $codeAction -Trigger $codeTrigger -Principal $codePrincipal `
    -Settings $codeSettings -Description 'Opens the Masters workspace in VS Code at logon.' -Force | Out-Null

Start-ScheduledTask -TaskName 'Masters app'
Write-Host 'Installed: "Masters app" (boot, logon, every 5 min) and "Masters VS Code" (logon).'
Write-Host "App log: $Log"
