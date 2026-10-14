#!/usr/bin/env bash
# Throwaway probe for spec 008 wave-0 checks 3 and 4 (open questions 1 and 2), row 008-11.
# OpenCode runs only as squeal-e2e: run from the agent user, this script sends itself, the probe
# plugin and the scripted provider to that user's home through tar and runs there.
#   bash docs/specifications/008-opencode-adapter/research/probes/wave-0-checks/checks.sh
# Every OpenCode run gets the isolation of test/helpers/opencode.ts (HOME, TMPDIR and the XDG
# directories in a temp directory, the config directories seeded, models fetch and autoupdate
# off) and the scripted provider, so no credentials and no network.
set -eu
if [ "$(id -un)" != squeal-e2e ]; then
  HERE=$(cd "$(dirname "$0")" && pwd)
  FIXTURE=$(cd "$HERE/../../../../../../test/fixtures/opencode" && pwd)
  E2E=(sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e
    PATH=/home/squeal-e2e/.npm-global/bin:/opt/squeal-e2e/node24/bin:/usr/bin:/bin)
  D=/home/squeal-e2e/opencode-wave0
  { tar -C "$HERE" -cf - checks.sh q2-plugin.js; } | "${E2E[@]}" bash -c "rm -rf $D && mkdir -p $D && tar -C $D -xf -"
  tar -C "$FIXTURE" -cf - scripted-provider.ts | "${E2E[@]}" tar -C $D -xf -
  exec "${E2E[@]}" KEEP="${KEEP:-}" bash -c "cd / && bash $D/checks.sh $D" </dev/null
fi
D=$1
[ "$(opencode --version)" = 1.18.35 ] || { echo "needs OpenCode 1.18.35" >&2; exit 2; }
T=$(mktemp -d /tmp/oc-wave0.XXXXXX)
echo "temp dir: $T"

seed() {
  mkdir -p "$1/node_modules"
  echo '{"dependencies":{"@opencode-ai/plugin":"1.18.35"}}' > "$1/package.json"
  echo '{"lockfileVersion":3,"packages":{"":{"dependencies":{"@opencode-ai/plugin":"1.18.35"}}}}' > "$1/package-lock.json"
}
# A fresh isolated home per check.
fresh() {
  R=$T/$1
  mkdir -p "$R/home" "$R/tmp" "$R/xdg/config/opencode" "$R/xdg/data" "$R/xdg/cache" "$R/xdg/state" "$R/proj"
  seed "$R/xdg/config/opencode"
  git -C "$R/proj" init -q
  ENV=(env -i PATH="$PATH" HOME="$R/home" TMPDIR="$R/tmp" XDG_CONFIG_HOME="$R/xdg/config"
    XDG_DATA_HOME="$R/xdg/data" XDG_CACHE_HOME="$R/xdg/cache" XDG_STATE_HOME="$R/xdg/state"
    OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_AUTOUPDATE=1 PROBE_LOG="$R/probe.log")
}
# One `opencode run` against a fresh provider playing $1 (a JSON plan); the provider config is
# the project's opencode.json, so the global config holds only what `opencode plugin -g` wrote.
oc_run() {
  local plan=$1 label=$2; shift 2
  echo "$plan" > "$R/plan.json"
  rm -f "$R/url"
  node "$D/scripted-provider.ts" "$R/plan.json" "$R/requests.$label.jsonl" "$R/url" > /dev/null &
  local provider=$!
  for _ in $(seq 50); do [ -s "$R/url" ] && break; sleep 0.1; done
  cat > "$R/proj/opencode.json" <<EOF
{ "provider": { "scripted": { "npm": "@ai-sdk/openai-compatible", "name": "Scripted",
    "options": { "baseURL": "$(cat "$R/url")", "apiKey": "not-a-credential" },
    "models": { "scripted-1": { "name": "S" }, "scripted-small": { "name": "S small" } } } },
  "model": "scripted/scripted-1", "small_model": "scripted/scripted-small",
  "permission": { "edit": "allow", "bash": "allow" }, "share": "disabled", "autoupdate": false }
EOF
  echo "-- run $label"
  local code=0
  (cd "$R/proj" && exec "${ENV[@]}" "$@" opencode run --format json -m scripted/scripted-1 "hello" \
    < /dev/null > "$R/stdout.$label" 2> "$R/stderr.$label") || code=$?
  echo "   exit $code"
  kill $provider; wait $provider 2>/dev/null || true
}
plugin() { (cd "$R/proj" && "${ENV[@]}" opencode plugin "$@" < /dev/null 2>&1 | sed 's/^/   /' | tail -6); }
global_config() { echo "   global config:"; cat "$R"/xdg/config/opencode/opencode.json* 2>/dev/null | sed 's/^/     /'; echo; }
cache() { echo "   cache packages:"; (cd "$R/xdg/cache/opencode" 2>/dev/null && find packages -maxdepth 4 \( -type l -printf '     %p -> %l\n' \) -o \( -maxdepth 4 -printf '     %p\n' \) 2>/dev/null | head -20); }
loaded() { echo "   plugin inits since last look:"; sed 's/^/     /' "$R/probe.log" 2>/dev/null; : > "$R/probe.log"; grep -h -iE 'plugin|squeal-probe' "$R"/xdg/data/opencode/log/*.log 2>/dev/null | grep -iE 'error|fail|skip' | tail -3 | cut -c1-300 | sed 's/^/     log: /'; rm -f "$R"/xdg/data/opencode/log/*.log; }
# A versioned plugin package, as install.sh would unpack it: package.json `exports["./server"]`.
package() {
  local dir=$1 version=$2
  mkdir -p "$dir/dist"
  echo "{\"name\":\"squeal-probe\",\"version\":\"$version\",\"type\":\"module\",\"exports\":{\"./server\":\"./dist/plugin.js\"}}" > "$dir/package.json"
  cat > "$dir/dist/plugin.js" <<EOF
import { appendFileSync } from "node:fs";
export const SquealProbe = async () => {
  appendFileSync(process.env.PROBE_LOG, "init $version from " + import.meta.url + "\n");
  return {};
};
EOF
}
PLAN_TEXT='[{"text":"ok"}]'

echo "== check 3 (open question 1): opencode plugin file:<dir> -g, then file:<v2> -g --force"
fresh q1
package "$R/pkgs/squeal-0.0.1" 0.0.1
package "$R/pkgs/squeal-0.0.2" 0.0.2
echo "-- opencode plugin file:$R/pkgs/squeal-0.0.1 -g"; plugin "file:$R/pkgs/squeal-0.0.1" -g
global_config; cache
oc_run "$PLAN_TEXT" v1; loaded
echo "-- v1's directory edited in place (dist/plugin.js now says 0.0.1-edited)"
sed -i 's/init 0.0.1/init 0.0.1-edited/' "$R/pkgs/squeal-0.0.1/dist/plugin.js"
oc_run "$PLAN_TEXT" v1edit; loaded
echo "-- opencode plugin file:$R/pkgs/squeal-0.0.2 -g (no --force)"; plugin "file:$R/pkgs/squeal-0.0.2" -g
global_config
echo "-- opencode plugin file:$R/pkgs/squeal-0.0.2 -g --force"; plugin "file:$R/pkgs/squeal-0.0.2" -g --force
global_config; cache
oc_run "$PLAN_TEXT" v2; loaded
echo "-- v1's directory deleted"
rm -rf "$R/pkgs/squeal-0.0.1"
oc_run "$PLAN_TEXT" v2-v1gone; loaded
echo "   stderr tail:"; tail -3 "$R/stderr.v2-v1gone" | cut -c1-300 | sed 's/^/     /'

echo "== check 3b: an absolute-path spec (no file: prefix), then --force with the next version"
fresh q1b
package "$R/pkgs/squeal-0.0.1" 0.0.1
package "$R/pkgs/squeal-0.0.2" 0.0.2
echo "-- opencode plugin $R/pkgs/squeal-0.0.1 -g"; plugin "$R/pkgs/squeal-0.0.1" -g
global_config; cache
oc_run "$PLAN_TEXT" p1; loaded
echo "-- opencode plugin $R/pkgs/squeal-0.0.2 -g --force"; plugin "$R/pkgs/squeal-0.0.2" -g --force
global_config
oc_run "$PLAN_TEXT" p2; loaded

echo "== check 3c: a stable symlink (pkgs/current) installed with file:, then repointed to the next version"
fresh q1c
package "$R/pkgs/squeal-0.0.1" 0.0.1
package "$R/pkgs/squeal-0.0.2" 0.0.2
ln -s squeal-0.0.1 "$R/pkgs/current"
echo "-- opencode plugin file:$R/pkgs/current -g"; plugin "file:$R/pkgs/current" -g
global_config; cache
oc_run "$PLAN_TEXT" c1; loaded
ln -sfn squeal-0.0.2 "$R/pkgs/current"
echo "-- pkgs/current -> squeal-0.0.2"
oc_run "$PLAN_TEXT" c2; loaded

echo "== check 4 (open question 2): a text part pushed to output.parts in chat.message"
for variant in after synthetic noid; do
  fresh "q2-$variant"
  mkdir -p "$R/xdg/config/opencode/plugins"
  cp "$D/q2-plugin.js" "$R/xdg/config/opencode/plugins/"
  oc_run "$PLAN_TEXT" "q2" PROBE_Q2="$variant"
  echo "   $variant: $(grep -c . "$R/requests.q2.jsonl" 2>/dev/null || echo 0) requests; plugin: $(cat "$R/probe.log" 2>/dev/null | tr '\n' ' ')"
  node -e '
    const fs = require("node:fs");
    const log = process.argv[1];
    const reqs = (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "").split("\n").filter(Boolean).map(JSON.parse)
      .filter((r) => r.model === "scripted-1");
    const user = reqs[0]?.messages.filter((m) => m.role === "user") ?? [];
    console.log("   first request user messages:", JSON.stringify(user).slice(0, 400));
    console.log("   SQUEAL-Q2 in first request:", JSON.stringify(reqs[0] ?? {}).includes("SQUEAL-Q2"));
  ' "$R/requests.q2.jsonl" 2>&1 || true
  grep -h -iE 'invalid user part|error' "$R"/xdg/data/opencode/log/*.log 2>/dev/null | tail -2 | cut -c1-300 | sed 's/^/   log: /'
  echo "   stderr tail: $(tail -2 "$R/stderr.q2" | cut -c1-200 | tr '\n' ' ')"
done
[ -n "${KEEP:-}" ] || rm -rf "$T"
