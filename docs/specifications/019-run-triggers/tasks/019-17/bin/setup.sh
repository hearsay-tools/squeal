#!/bin/sh
# Throwaway probe for 019-17 (after 017-13's setup.sh). Not product code.
# The case root /home/squeal-e2e/runs/d1917, as squeal-e2e; scratch /tmp/dogfood-019-17.
#   sh setup.sh <step>...
#     dirs     the case directories
#     pin      `git archive 4163f5de8` (main at 0.1.398, unreleased) of both plugins, the Codex
#              runtime and both marketplace manifests into pin/, each marketplace renamed
#              `hearsay`, so the plugin id is squeal@hearsay as a released install's
#     bundles  git bundles: cezarion at its HEAD (read only on /home/agent/projects/cezar), and
#              the Part A fixture (make-fixture.mjs) with a 15 s e2e file
#     clone    both clones from the bundles, each on a local branch `dogfood` at its commit
#     deps     cezarion: corepack pnpm install --frozen-lockfile; fixture: npm install
#     install  Claude Code: the plugin at user scope in the case's CLAUDE_CONFIG_DIR, the
#              launcher as bin/squeal. Codex: the case's CODEX_HOME with the host's model
#              provider settings and no credential, the plugin from pin/, the 0.1.398 runtime
#              selected in its data folder, as an update leaves it
#     configs  squeal.config.json per variant, each a commit on its own branch (bases.json)
# No model runs here.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
R=/home/squeal-e2e/runs/d1917
W=/tmp/dogfood-019-17
WT=$(cd "$here/../../../../../.." && pwd)
CEZ=/home/agent/projects/cezar
REF=4163f5de8
as() { dir=$1; shift; node "$here/as-e2e.mjs" "$R" "$R/$dir" "$@"; }
e2e() { sudo -n -u squeal-e2e "$@"; }
data=$R/codex/plugins/data/squeal-hearsay

for step in "$@"; do
  echo "== $step $(date -u +%FT%TZ) load $(cut -d' ' -f1 /proc/loadavg)"
  case "$step" in
    dirs)
      e2e mkdir -p "$R/home" "$R/tmp" "$R/codex" "$R/claude" "$R/xdg" "$R/evals" "$R/bin" "$R/pin" "$R/logs" "$R/corepack" "$R/pnpm-store"
      mkdir -p "$W/bundles" "$W/logs" && chmod 755 "$W" "$W/bundles"
      ;;
    pin)
      e2e rm -rf "$R/pin" && e2e mkdir "$R/pin"
      git -C "$WT" archive "$REF" plugins/claude-code plugins/codex plugins/codex-runtime .claude-plugin .agents/plugins | e2e tar -x -C "$R/pin"
      e2e sed -i '0,/"name": "squeal"/s//"name": "hearsay"/' "$R/pin/.claude-plugin/marketplace.json" "$R/pin/.agents/plugins/marketplace.json"
      e2e grep -h '"name"\|"version"' "$R/pin/.claude-plugin/marketplace.json" "$R/pin/.agents/plugins/marketplace.json" "$R/pin/plugins/claude-code/.claude-plugin/plugin.json" "$R/pin/plugins/codex-runtime/runtime.json" | head -8
      ;;
    bundles)
      rm -f "$W/bundles/cezarion.bundle" "$W/bundles/fixture.bundle"
      git -C "$CEZ" bundle create "$W/bundles/cezarion.bundle" HEAD
      node "$here/make-fixture.mjs" "$WT" "$W/fixture-src" 15000
      git -C "$W/fixture-src" bundle create "$W/bundles/fixture.bundle" HEAD
      chmod 644 "$W"/bundles/*.bundle
      git bundle verify "$W/bundles/cezarion.bundle" >/dev/null && git bundle verify "$W/bundles/fixture.bundle" >/dev/null && echo verified
      echo "cezarion $(git -C "$CEZ" rev-parse HEAD) fixture $(git -C "$W/fixture-src" rev-parse HEAD)"
      ;;
    clone)
      for repo in cezarion fixture; do
        e2e rm -rf "$R/$repo"
        as . git init -q -b bundle-base "$repo"
        as "$repo" git fetch -q "$W/bundles/$repo.bundle" 'HEAD:refs/remotes/bundle/head'
        as "$repo" git config user.name dogfood
        as "$repo" git config user.email dogfood@squeal-e2e.invalid
        as "$repo" git checkout -q -b dogfood refs/remotes/bundle/head
        as "$repo" git log --oneline -1
      done
      ;;
    deps)
      as cezarion corepack pnpm install --frozen-lockfile --reporter=silent
      as fixture npm install --no-audit --no-fund --loglevel=error
      ;;
    install)
      e2e cp "$R/pin/plugins/claude-code/bin/squeal-launcher" "$R/bin/squeal"
      e2e ln -sf /home/squeal-e2e/.npm-global/bin/claude "$R/bin/claude"
      e2e ln -sf /home/squeal-e2e/.npm-global/bin/codex "$R/bin/codex"
      as . corepack enable --install-directory "$R/bin" pnpm
      as . claude plugin marketplace add "$R/pin"
      as . claude plugin install squeal@hearsay
      # Codex: the host's provider block and model catalog, no credential (the key is an env name).
      e2e cp "$W/codex-catalog.json" "$R/codex/catalog.json"
      printf '%s\n' 'model_provider = "cliproxy"' 'model = "gpt-6-astra"' \
        "model_catalog_json = \"$R/codex/catalog.json\"" 'check_for_update_on_startup = false' \
        '[model_providers.cliproxy]' 'name = "CLI Proxy"' 'base_url = "https://cliproxy.home.jarka.pl/v1"' \
        'env_key = "CLIPROXY_API_KEY"' 'wire_api = "responses"' 'requires_openai_auth = false' \
        'supports_websockets = false' | e2e tee "$R/codex/config.toml" >/dev/null
      as . codex plugin marketplace add "$R/pin"
      as . codex plugin add squeal@hearsay
      version=$(as . node -e 'process.stdout.write(require(process.argv[1]).version)' "$R/pin/plugins/codex-runtime/runtime.json")
      e2e mkdir -p "$data/versions" "$data/runtime"
      e2e rm -rf "$data/versions/$version"
      e2e cp -a "$R/pin/plugins/codex-runtime" "$data/versions/$version"
      printf '{"schema":1,"version":"%s"}\n' "$version" | e2e tee "$data/runtime/current.json" >/dev/null
      as . squeal --version
      as . claude --version
      as . codex --version
      ;;
    configs)
      node "$here/configs.mjs" "$R" "$here/as-e2e.mjs" > "$W/bases.json"
      cat "$W/bases.json"
      ;;
    *) echo "unknown step $step"; exit 2 ;;
  esac
done
