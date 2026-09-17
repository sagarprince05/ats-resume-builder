# Assembles a ready-to-upload website folder for free hosting.
#   powershell -ExecutionPolicy Bypass -File hosting\build-site.ps1                    (Cloudflare Pages, default)
#   powershell -ExecutionPolicy Bypass -File hosting\build-site.ps1 -Target netlify
#   powershell -ExecutionPolicy Bypass -File hosting\build-site.ps1 -Target github     (GitHub Pages: no relay, visitors use their own key)
#
# Output: build/site-<target> and build/site-<target>.zip
#
# cloudflare / netlify: the folder contains the app plus a small relay
# function. The keys are NOT in the folder: you add them once on the
# hosting dashboard as the GROQ_API_KEY and/or GEMINI_API_KEY secrets and
# the relay attaches them on the server. Visitors never see a key and
# never need one of their own.
#
# github: GitHub Pages cannot run functions, so the app asks each visitor
# for their own free Groq key instead.
#
# Runs under Windows PowerShell 5.1 and PowerShell 7 on Linux (CI).
param(
  [ValidateSet("cloudflare", "netlify", "github")] [string]$Target = "cloudflare",
  [string]$GroqModel = "openai/gpt-oss-120b",
  [string]$GeminiModel = "gemini-3.8-flash"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$out = Join-Path (Join-Path $root "build") "site-$Target"
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $out | Out-Null

# The app itself.
Copy-Item index.html, manifest.webmanifest, sw.js $out
foreach ($d in @("css", "js", "vendor", "icons")) { Copy-Item -Recurse (Join-Path $root $d) (Join-Path $out $d) }

# Point the app at the relay on the same site (none for GitHub Pages).
$relay = if ($Target -eq "github") { "" } else { "/api" }
$cfg = "window.APP_CONFIG = { groqKey: '', groqModel: '$GroqModel', geminiKey: '', geminiModel: '$GeminiModel', provider: '', relay: '$relay' };`r`n"
[IO.File]::WriteAllText((Join-Path (Join-Path $out "js") "config.js"), $cfg, (New-Object Text.UTF8Encoding $false))

# Platform files (relay function, headers).
$platform = Join-Path $PSScriptRoot $Target
if (Test-Path $platform) {
  Get-ChildItem -Path $platform -Force | ForEach-Object { Copy-Item -Recurse -Force $_.FullName (Join-Path $out $_.Name) }
}

# Zip it too, for the drag-and-drop uploaders.
$zip = "$out.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $out "*") -DestinationPath $zip

Write-Host ""
Write-Host "Site folder ready: $out"
Write-Host "Zip of the same:   $zip"
Write-Host ""
switch ($Target) {
  "cloudflare" {
    Write-Host "Cloudflare Pages: push this folder to a GitHub repo and connect it in"
    Write-Host "Workers & Pages -> Create -> Pages (no build command, output directory '/')."
    Write-Host "Then Settings -> Variables and Secrets -> add secrets GROQ_API_KEY and/or GEMINI_API_KEY and redeploy."
  }
  "netlify" {
    Write-Host "Netlify: drag the folder onto app.netlify.com/drop (or Sites -> Add new site -> Deploy manually)."
    Write-Host "Then Site configuration -> Environment variables -> add GROQ_API_KEY and/or GEMINI_API_KEY, and Deploys -> Trigger deploy."
  }
  "github" {
    Write-Host "GitHub Pages: the workflow in .github/workflows/build.yml publishes this folder"
    Write-Host "automatically on every push to main once Pages is set to 'GitHub Actions'."
  }
}
Write-Host "Full steps: hosting/HOSTING.md"
