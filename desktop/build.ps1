# Builds the Windows desktop app.
#   powershell -ExecutionPolicy Bypass -File desktop\build.ps1
#   powershell -ExecutionPolicy Bypass -File desktop\build.ps1 -GroqKey "gsk_..."
#
# Pass -GroqKey to bake your Groq API key into the build. The app then
# rewrites resumes automatically and shows no API-key settings at all.
# The key is written only into the staged copy inside the .exe, never into
# the source tree. Anyone holding the .exe can extract it, and all usage
# counts against that key, so only share builds you are happy with.
#
# Output: dist\ATS Resume Builder Setup.exe  and  dist\ATS Resume Builder.exe
param(
  [string]$GroqKey = "",
  [string]$GroqModel = "openai/gpt-oss-120b"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$appName = "ATS Resume Builder"

python -c "import PyInstaller" 2>$null
if (-not $?) { Write-Host "Installing PyInstaller..."; python -m pip install --quiet pyinstaller }

if (-not (Test-Path "desktop\icon.ico")) { python desktop\make_icons.py }

# Stage only the files the app needs.
$stage = Join-Path $root "build\web"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item index.html, manifest.webmanifest, sw.js $stage
Copy-Item -Recurse css, js, vendor, icons $stage

# Bake the API key into the staged copy only (never the source tree).
$esc = { param($s) $s.Replace('\', '\\').Replace("'", "\'") }
if ($GroqKey -ne "") {
  $cfg = "window.APP_CONFIG = { groqKey: '$(& $esc $GroqKey)', groqModel: '$GroqModel' };`r`n"
  # WriteAllText with an explicit encoding avoids the BOM that Set-Content adds.
  [IO.File]::WriteAllText((Join-Path $stage "js\config.js"), $cfg, (New-Object Text.UTF8Encoding $false))
  Write-Host "Groq key baked in ($GroqModel). AI settings will be hidden in this build."
} else {
  Write-Host "No key given: this build asks each user for their own Groq key."
}

python -m PyInstaller --noconfirm --clean --windowed --onefile `
  --name "ATS Resume Builder" `
  --icon "$root\desktop\icon.ico" `
  --add-data "$stage;web" `
  --distpath dist --workpath build\pyinstaller --specpath build `
  "$root\desktop\launcher.py"
if ($LASTEXITCODE -ne 0) { Write-Host "PyInstaller failed (exit $LASTEXITCODE)."; exit 1 }
if (-not (Test-Path "dist\ATS Resume Builder.exe")) { Write-Host "Build did not produce the exe."; exit 1 }

# Build the single-file installer, with the app executable inside it.
python -m PyInstaller --noconfirm --clean --windowed --onefile `
  --name "$appName Setup" `
  --icon "$root\desktop\icon.ico" `
  --add-data "$root\dist\$appName.exe;payload" `
  --distpath dist --workpath build\pyinstaller-setup --specpath build `
  "$root\desktop\installer.py"
if ($LASTEXITCODE -ne 0) { Write-Host "Installer build failed (exit $LASTEXITCODE)."; exit 1 }
if (-not (Test-Path "dist\$appName Setup.exe")) { Write-Host "Build did not produce the installer."; exit 1 }

Write-Host ""
Write-Host "Built:"
Write-Host "  dist\$appName Setup.exe   <- send this one; double-click installs it"
Write-Host "  dist\$appName.exe         (portable, runs without installing)"
if ($GroqKey -eq "") {
  Write-Host ""
  Write-Host "This build has no AI key, so it will ask each user for their own Groq key."
  Write-Host "To bake yours in and hide all key settings, rebuild with:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File desktop\build.ps1 -GroqKey `"gsk_...`""
}
