#!/bin/sh
# Throwaway probe for hearsay-tools/squeal#65 (../../issue-65.md). Re-run: sh run.sh [plugin-dir]
# A fresh /tmp/i65-XXXXXX with its own HOME and XDG_RUNTIME_DIR; the only daemon started is the
# scratch repository's, stopped at the end. Squeal is a copy of the installed plugin (0.1.234 by
# default). Test files: test/pass.test.ts passes, test/fail.test.ts fails.
set -u
plugin_src=${1:-$HOME/.claude/plugins/cache/hearsay/squeal/0.1.234}
here=$(cd "$(dirname "$0")" && pwd)
read -r load _ </proc/loadavg
cpus=$(nproc)
if [ "$(echo "$load < $cpus" | bc)" != 1 ]; then echo "load $load >= $cpus CPUs; not running"; exit 2; fi
echo "load $load on $cpus CPUs"
S=$(mktemp -d /tmp/i65-XXXXXX)
export HOME=$S/home XDG_RUNTIME_DIR=$S/run npm_config_cache=$S/npm-cache
mkdir -p "$HOME" && mkdir -m 700 "$XDG_RUNTIME_DIR"
cp -a "$plugin_src" "$S/plugin"
sq() { node "$S/plugin/dist/cli/squeal.mjs" "$@"; }
echo "scratch $S; squeal $(sq --version); jq $(jq --version)"
repo=$S/repo
mkdir "$repo" && cp -a "$here/fixture/." "$repo/"
cd "$repo"
git init -q -b main && git config user.email p@i65 && git config user.name i65
printf 'node_modules\n' >.gitignore
echo '{}' >squeal.config.json
npm install --silent --no-audit --no-fund >/dev/null 2>&1 || { echo "npm install failed"; exit 1; }
git add -A && git commit -qm fixture
sq start "$repo" 2>&1 | head -3
sq run --all --wait 2>&1 | head -2
P="test/pass.test.ts test/fail.test.ts"
form() { # label, then the squeal arguments
  label=$1; shift
  echo "=== $label: squeal $*"
  sq "$@" >"$S/$label.json" 2>"$S/$label.err"; echo "exit $?"
  echo "top-level keys holding testFiles: $(jq -c '[to_entries[] | select(.value | type == "object" and has("testFiles")) | .key]' "$S/$label.json")"
  echo "stderr:"; sed 's/^/  /' "$S/$label.err"
}
# shellcheck disable=SC2086
form snapshot status --json $P
# shellcheck disable=SC2086
form wait status --wait 30000 --json $P
for label in snapshot wait; do
  for key in named wait; do
    echo "=== jq -r '.$key.testFiles[] | \"\\(.path) \\(.state) \\(.verdict // \"-\")\"' $label.json"
    out=$(jq -r ".$key.testFiles[] | \"\\(.path) \\(.state) \\(.verdict // \"-\")\"" "$S/$label.json" 2>&1); rc=$?
    echo "jq exit $rc; $(printf '%s' "$out" | grep -c .) lines"
    [ -n "$out" ] && printf '%s\n' "$out" | sed 's/^/  /'
  done
done
F='.testFiles[]? | select(.state != "current" or .verdict != "pass") | .path'
for label in snapshot wait; do
  for key in named wait; do
    echo "=== the issue's filter: jq -r '.$key$F' $label.json"
    out=$(jq -r ".$key$F" "$S/$label.json" 2>&1); rc=$?
    echo "jq exit $rc; $(printf '%s' "$out" | grep -c .) lines"
    [ -n "$out" ] && printf '%s\n' "$out" | sed 's/^/  /'
    jq -e ".$key$F" "$S/$label.json" >/dev/null 2>&1; echo "same filter with jq -e: exit $?"
  done
  echo "=== $label.json has named: $(jq 'has("named")' "$S/$label.json"); has wait: $(jq 'has("wait")' "$S/$label.json")"
done
echo "=== payload of each form, testFiles shown"
jq -c '.named | {outcome, code, testFiles: [.testFiles[] | {path, state, verdict}]}' "$S/snapshot.json"
jq -c '.wait | {outcome, code, testFiles: [.testFiles[] | {path, state, verdict}]}' "$S/wait.json"
echo "=== same keys inside the two payloads: $(jq -n --slurpfile a "$S/snapshot.json" --slurpfile b "$S/wait.json" '($a[0].named | keys) == ($b[0].wait | keys)')"
echo "=== stop"
sq stop "$repo" 2>&1 | head -2
cd / && rm -rf "$S"
read -r load _ </proc/loadavg; echo "load after $load"
