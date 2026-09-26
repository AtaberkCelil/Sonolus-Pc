#!/usr/bin/env bash
# Verify Sonopc's chart parsing against the community reference converter.
#
#   npm run verify:parity
#
# Clones the reference converter into tools/verify-parity/.cache on first run
# (needs network + python3), then compares combo events for every bundled chart.
# Re-runs afterwards are offline: the checkout and venv are cached.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
cache="$here/.cache"
ref_repo="$cache/sonolus-level-converters"
venv="$cache/venv"

cd "$repo_root"

if [ ! -d "$ref_repo/.git" ]; then
  echo "==> Cloning reference converter (first run only)"
  mkdir -p "$cache"
  git clone --depth 1 --quiet https://github.com/UntitledCharts/sonolus-level-converters.git "$ref_repo"
fi

if [ ! -x "$venv/bin/python" ]; then
  echo "==> Creating python venv (first run only)"
  python3 -m venv "$venv"
  "$venv/bin/pip" install --quiet --upgrade pip
  "$venv/bin/pip" install --quiet -r "$ref_repo/requirements.txt"
fi

echo "==> Parsing charts with Sonopc"
npx tsx "$here/ours.ts" > "$cache/ours.json"

echo "==> Parsing charts with the reference converter"
SLC_REPO="$ref_repo" "$venv/bin/python" "$here/reference.py" > "$cache/reference.json"

echo "==> Comparing"
node "$here/compare.mjs" "$cache/ours.json" "$cache/reference.json"
