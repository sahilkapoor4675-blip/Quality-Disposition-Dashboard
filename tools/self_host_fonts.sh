#!/usr/bin/env bash
# Downloads the exact fonts this app uses from Google Fonts and writes them into
# ./fonts/ as a local, self-hosted stylesheet -- so the dashboard never depends
# on fonts.googleapis.com / fonts.gstatic.com being reachable at runtime (the
# actual cause of a blank/slow first load on a restricted network; see
# CHANGELOG.md "V66.1"). index.html already loads the Google Fonts CDN
# *non-blocking*, so today's deploy works either way -- this script is for
# fully removing that dependency, not for fixing a broken page.
#
# WHY THIS IS A SCRIPT AND NOT ALREADY DONE: it downloads binary font files
# from the internet, which the environment that generated this patch could not
# do (no outbound network access there). Run this once, from any machine that
# DOES have internet access, then commit the ./fonts/ folder and redeploy.
#
# Usage:
#   cd Quality-Disposition-Dashboard-main
#   bash tools/self_host_fonts.sh
#   # then follow the printed instructions to switch index.html over
#
# Requires: curl (or wget), and bash/sed/grep (all standard on macOS/Linux;
# on Windows use WSL or Git Bash).

set -euo pipefail
cd "$(dirname "$0")/.."   # repo root, regardless of where this is invoked from

FONT_CSS_URL='https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Sora:wght@500;600;700;800&family=Outfit:wght@500;600;700;800&family=Allura&display=swap'
OUT_DIR="fonts"
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
# ^ Google's CSS2 endpoint returns different @font-face rules (woff2 vs woff vs
# ttf) depending on the User-Agent it sees. A modern desktop Chrome UA gets
# woff2 for every family, which is what this app's browser support targets.

fetch() { curl -fsSL -A "$UA" "$1"; }

command -v curl >/dev/null || { echo "curl is required. Install curl and re-run." >&2; exit 1; }

mkdir -p "$OUT_DIR"
echo "Fetching font manifest from Google Fonts..."
css="$(fetch "$FONT_CSS_URL")"
[ -n "$css" ] || { echo "Got an empty response from Google Fonts. Check your network and try again." >&2; exit 1; }

# Extract every font-file URL referenced in the manifest (one per weight/family).
mapfile -t urls < <(grep -oE 'https://fonts\.gstatic\.com/[^)]+' <<<"$css" | sort -u)
[ "${#urls[@]}" -gt 0 ] || { echo "No font file URLs found in the manifest -- Google may have changed their response format." >&2; exit 1; }

echo "Downloading ${#urls[@]} font files into ${OUT_DIR}/ ..."
local_css="$css"
count=0
for url in "${urls[@]}"; do
    fname="$(basename "$url")"
    # Google's filenames already carry a content hash and are unique per
    # family+weight+subset, e.g. "4UaZrEtFpBI4f1ZSIK9d4LjJ4WU9.woff2" -- safe
    # to use as-is, no risk of two different fonts colliding on one filename.
    curl -fsSL "$url" -o "${OUT_DIR}/${fname}"
    local_css="${local_css//$url//fonts/$fname}"
    count=$((count + 1))
done

printf '%s' "$local_css" > "${OUT_DIR}/fonts-local.css"
echo
echo "Done: downloaded $count font files and wrote ${OUT_DIR}/fonts-local.css"
echo
echo "Next steps:"
echo "  1. Commit the new ${OUT_DIR}/ folder (it's plain static files, safe to check in)."
echo "  2. In index.html, find the block marked"
echo "       <!-- SELF-HOSTED FONTS: after running tools/self_host_fonts.sh -->"
echo "     and follow the two one-line swaps described there (comment out the"
echo "     Google Fonts <link>, uncomment the local one)."
echo "  3. Redeploy. The dashboard now loads fonts from itself, not Google."
