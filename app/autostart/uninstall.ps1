# Removes the autostart tasks created by install.ps1. Run in PowerShell as administrator.
foreach ($name in 'Masters app', 'Masters VS Code') {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "Removed $name"
    }
}
Write-Host 'The app keeps running until you restart the PC or stop it.'
