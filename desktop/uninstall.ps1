# Removes ATS Resume Builder for the current user. Your saved resume data
# (kept in the app's browser profile) is left in place unless you delete
# %LOCALAPPDATA%\ATS Resume Builder yourself.
$appName = "ATS Resume Builder"
$dest = Join-Path $env:LOCALAPPDATA "Programs\$appName"
Get-Process -Name $appName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
foreach ($dir in @([Environment]::GetFolderPath("Programs"), [Environment]::GetFolderPath("Desktop"))) {
  Remove-Item (Join-Path $dir "$appName.lnk") -Force -ErrorAction SilentlyContinue
}
Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ATSResumeBuilder" -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $dest) {
  # Delete after this script exits, since it may be running from inside the folder.
  Start-Process cmd.exe -ArgumentList "/c timeout /t 2 /nobreak >nul & rmdir /s /q `"$dest`"" -WindowStyle Hidden
}
Write-Host "$appName has been uninstalled."
