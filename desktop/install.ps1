# Installs ATS Resume Builder for the current user (no admin rights needed).
# Copies the exe to %LOCALAPPDATA%\Programs\ATS Resume Builder and creates
# Start Menu and Desktop shortcuts plus an "Apps & features" entry.
$ErrorActionPreference = "Stop"
$appName = "ATS Resume Builder"
$src = Join-Path $PSScriptRoot "$appName.exe"
if (-not (Test-Path $src)) { Write-Host "Cannot find '$appName.exe' next to this script."; exit 1 }

$dest = Join-Path $env:LOCALAPPDATA "Programs\$appName"
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item $src (Join-Path $dest "$appName.exe") -Force
Copy-Item (Join-Path $PSScriptRoot "uninstall.ps1") $dest -Force
Copy-Item (Join-Path $PSScriptRoot "Uninstall.bat") $dest -Force

$exe = Join-Path $dest "$appName.exe"
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath("Programs"), [Environment]::GetFolderPath("Desktop"))) {
  $lnk = $shell.CreateShortcut((Join-Path $dir "$appName.lnk"))
  $lnk.TargetPath = $exe
  $lnk.WorkingDirectory = $dest
  $lnk.IconLocation = "$exe,0"
  $lnk.Description = "Build an ATS-friendly resume and export it to PDF or Word"
  $lnk.Save()
}

# Register in Settings > Apps so it can be uninstalled from there too.
$reg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ATSResumeBuilder"
New-Item -Path $reg -Force | Out-Null
Set-ItemProperty $reg "DisplayName" $appName
Set-ItemProperty $reg "DisplayIcon" $exe
Set-ItemProperty $reg "DisplayVersion" "1.0.0"
Set-ItemProperty $reg "Publisher" "ATS Resume Builder"
Set-ItemProperty $reg "InstallLocation" $dest
Set-ItemProperty $reg "UninstallString" "powershell.exe -ExecutionPolicy Bypass -File `"$dest\uninstall.ps1`""
Set-ItemProperty $reg "NoModify" 1 -Type DWord
Set-ItemProperty $reg "NoRepair" 1 -Type DWord

Write-Host ""
Write-Host "Installed to $dest"
Write-Host "Shortcuts added to the Start Menu and Desktop."
Start-Process $exe
