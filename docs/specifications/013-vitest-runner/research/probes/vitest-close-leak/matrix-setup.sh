#!/usr/bin/env bash
# Throwaway probe for research 013-05. Makes /tmp/vcl-matrix/<combo>/: a copy of fixture/ with
# one Vitest, Vite and Rolldown combination installed by npm (overrides pin Vite and Rolldown).
# npm's cache is under /tmp/vcl-matrix/npm-cache, not the host's. Usage: matrix-setup.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
M=/tmp/vcl-matrix
mkdir -p "$M"
export npm_config_cache=$M/npm-cache npm_config_audit=false npm_config_fund=false
combo() { # name vitest vite rolldown|-
  local d=$M/$1
  rm -rf "$d"; mkdir -p "$d"; cp -r "$HERE/fixture/." "$d/"
  local ov="\"vite\": \"$3\""
  [ "$4" != "-" ] && ov="$ov, \"rolldown\": \"$4\""
  printf '{ "name": "vcl-%s", "private": true, "type": "module",\n  "devDependencies": { "vitest": "%s", "vite": "%s" },\n  "overrides": { %s } }\n' "$1" "$2" "$3" "$ov" >"$d/package.json"
  (cd "$d" && npm install --silent >/dev/null)
  node -e 'for (const p of ["vitest","vite","rolldown"]) { try { process.stdout.write(p+"@"+require(process.argv[1]+"/node_modules/"+p+"/package.json").version+" ") } catch { process.stdout.write(p+"@none ") } } console.log("")' "$d"
}
combo cezar      4.1.10 8.1.4 1.1.5     # cezar's lockfile
combo squeal     5.0.3  8.3.2 1.2.12    # Squeal's own dev install
combo latest     5.0.5  8.3.5 1.2.15    # latest on 2026-10-21
combo v4-latest  4.1.12 8.3.5 1.2.15    # latest Vitest 4 on the latest Vite 8
combo vite7      4.1.10 7.3.7 -         # Vite 7: no Rolldown
combo vite7-v5   5.0.5  7.3.7 -
