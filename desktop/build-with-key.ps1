# Builds the installer with your Groq API key baked in, so the finished app
# never shows any API-key settings. Double-click "Build with my key.bat".
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")

function Read-Secret($prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

Write-Host ""
Write-Host "  ATS Resume Builder - build with your AI keys" -ForegroundColor Cyan
Write-Host "  ---------------------------------------------"
Write-Host "  Both providers are free. Give one key or both (Enter to skip one)."
Write-Host "    Groq   -> console.groq.com -> API Keys        (about 1,000 requests a day)"
Write-Host "    Gemini -> aistudio.google.com -> Get API key   (backup when Groq is busy)"
Write-Host "  Nothing you type here is saved anywhere except inside the .exe."
Write-Host ""
$groq   = Read-Secret "  Groq API key   (Enter to skip)"
$gemini = Read-Secret "  Gemini API key (Enter to skip)"

if ($groq -eq "" -and $gemini -eq "") { Write-Host "  No key entered. Nothing built."; exit 1 }
foreach ($k in @($groq, $gemini)) { if ($k -ne "" -and $k.Length -lt 20) { Write-Host "  One of those does not look like a full key. Nothing built."; exit 1 } }

Write-Host ""
Write-Host "  Building... this takes about a minute." -ForegroundColor Yellow
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build.ps1") -GroqKey $groq -GeminiKey $gemini | Out-Null
$groq = $null; $gemini = $null
if ($LASTEXITCODE -ne 0) { Write-Host "  Build failed. See the messages above." -ForegroundColor Red; exit 1 }

Copy-Item (Join-Path $root "dist\ATS Resume Builder Setup.exe") $desktop -Force

Write-Host ""
Write-Host "  Done." -ForegroundColor Green
Write-Host "  On your Desktop: 'ATS Resume Builder Setup.exe'"
Write-Host "  Send that file to your friend. It installs with a double-click and"
Write-Host "  uses your keys automatically, with no settings to fill in."
Write-Host ""
Write-Host "  Remember: anyone with this .exe can use (and extract) your keys,"
Write-Host "  and all their usage counts against your accounts."
Write-Host ""
