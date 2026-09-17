#!/usr/bin/env bash
# Assembles the website folder on a hosting platform's own build machine
# (Cloudflare Pages / Netlify connected to the GitHub repo), where
# PowerShell is not available. Same output as build-site.ps1.
#
#   bash hosting/build-site.sh cloudflare   -> build/site-cloudflare
#   bash hosting/build-site.sh netlify      -> build/site-netlify
#   bash hosting/build-site.sh github       -> build/site-github (no relay)
set -euo pipefail
target="${1:-cloudflare}"
groq_model="${GROQ_MODEL:-openai/gpt-oss-120b}"
gemini_model="${GEMINI_MODEL:-gemini-3.8-flash}"
case "$target" in cloudflare|netlify|github) ;; *) echo "unknown target: $target" >&2; exit 1 ;; esac

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/build/site-$target"
rm -rf "$out"; mkdir -p "$out"

# The app itself.
cp "$root/index.html" "$root/manifest.webmanifest" "$root/sw.js" "$out/"
for d in css js vendor icons; do cp -r "$root/$d" "$out/$d"; done

# Point the app at the relay on the same site (none for GitHub Pages).
relay="/api"; [ "$target" = "github" ] && relay=""
printf "window.APP_CONFIG = { groqKey: '', groqModel: '%s', geminiKey: '', geminiModel: '%s', provider: '', relay: '%s' };\n" \
  "$groq_model" "$gemini_model" "$relay" > "$out/js/config.js"

# Platform files (relay function, headers).
if [ -d "$root/hosting/$target" ]; then cp -r "$root/hosting/$target/." "$out/"; fi

echo "Site folder ready: $out"
