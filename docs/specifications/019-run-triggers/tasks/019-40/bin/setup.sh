#!/bin/sh
# Throwaway probe for 019-40 (Round 3), after 019-33's setup.sh. Not product code.
# The case root /home/squeal-e2e/runs/d1940, as squeal-e2e; scratch /tmp/dogfood-019-40.
# Round 1's unchanged scripts (as-e2e.mjs, mem.mjs, store.mjs, timeline.mjs) run from
# ../../019-17/bin, Round 2's configs.mjs from ../../019-33/bin; this folder holds what changed.
#   sh setup.sh <step>...
#     dirs     the case directories; the scratch bin/ (019-17's, 019-33's, then these scripts) for
#              the e2e user; pnpm's store is Round 2's (same user, packages only)
#     pin      `git archive 64ed7667e` (main at 0.1.401) of both plugins, the Codex runtime and
#              both marketplace manifests into pin/, each marketplace renamed `hearsay`
#     bundles  Round 2's two bundles, unchanged: cezarion at 10e7a5782 and the Part A fixture
#              with a 15 s e2e file, so all three rounds run the same commits
#     clone    both clones from the bundles, each on a local branch `dogfood` at its commit
#     deps     cezarion: corepack pnpm install --frozen-lockfile; fixture: npm install
#     install  Claude Code: the plugin at user scope; Codex: the plugin and the 0.1.401
#              runtime selected in its data folder, as an update leaves it
#     configs  squeal.config.json per variant, each a commit on its own branch (bases.json),
#              by Round 2's configs.mjs
#     trust    Codex trusts the plugin's hooks again, both Stop handlers among them
#              (`squeal init --harness codex --trust --yes` in the fixture on fix-h2)
#     cleanup  `squeal stop` in both clones, mem.mjs for each, and the e2e user's processes
# No model runs here.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
r1=$(cd "$here/../../019-17/bin" && pwd)
r2=$(cd "$here/../../019-33/bin" && pwd)
R=/home/squeal-e2e/runs/d1940
W=/tmp/dogfood-019-40
WT=$(cd "$here/../../../../../.." && pwd)
REF=64ed7667e
as() { dir=$1; shift; node "$r1/as-e2e.mjs" "$R" "$R/$dir" "$@"; }
e2e() { sudo -n -u squeal-e2e "$@"; }
data=$R/codex/plugins/data/squeal-hearsay

for step in "$@"; do
  echo "== $step $(date -u +%FT%TZ) load $(cut -d' ' -f1 /proc/loadavg)"
  case "$step" in
    dirs)
      e2e mkdir -p "$R/home/.local/share" "$R/tmp" "$R/codex" "$R/claude" "$R/xdg" "$R/evals" "$R/bin" "$R/pin" "$R/logs" "$R/corepack"
      # pnpm 11 keeps its store under $HOME/.local/share/pnpm (Round 2's .modules.yaml), not in
      # npm_config_store_dir.
      e2e ln -sfn /home/squeal-e2e/runs/d1933/home/.local/share/pnpm "$R/home/.local/share/pnpm"
      e2e ln -sfn /home/squeal-e2e/runs/d1917/pnpm-store "$R/pnpm-store"
      mkdir -p "$W/bundles" "$W/logs" "$W/bin" && chmod 755 "$W" "$W/bundles" "$W/bin" "$W/logs"
      cp "$r1"/*.mjs "$r1"/*.sh "$W/bin/" && cp "$r2"/* "$W/bin/" && cp "$here"/* "$W/bin/" && chmod 644 "$W"/bin/*.mjs
      cp /tmp/dogfood-019-17/codex-catalog.json "$W/codex-catalog.json" && chmod 644 "$W/codex-catalog.json"
      ;;
    pin)
      e2e rm -rf "$R/pin" && e2e mkdir "$R/pin"
      git -C "$WT" archive "$REF" plugins/claude-code plugins/codex plugins/codex-runtime .claude-plugin .agents/plugins | e2e tar -x -C "$R/pin"
      e2e sed -i '0,/"name": "squeal"/s//"name": "hearsay"/' "$R/pin/.claude-plugin/marketplace.json" "$R/pin/.agents/plugins/marketplace.json"
      e2e grep -h '"name"\|"version"' "$R/pin/.claude-plugin/marketplace.json" "$R/pin/.agents/plugins/marketplace.json" "$R/pin/plugins/claude-code/.claude-plugin/plugin.json" "$R/pin/plugins/codex-runtime/runtime.json" | head -8
      ;;
    bundles)
      rm -f "$W/bundles/cezarion.bundle" "$W/bundles/fixture.bundle"
      cp /tmp/dogfood-019-33/bundles/cezarion.bundle /tmp/dogfood-019-33/bundles/fixture.bundle "$W/bundles/"
      chmod 644 "$W"/bundles/*.bundle
      git bundle verify "$W/bundles/cezarion.bundle" >/dev/null && git bundle verify "$W/bundles/fixture.bundle" >/dev/null && echo verified
      echo "cezarion $(git bundle list-heads "$W/bundles/cezarion.bundle") fixture $(git bundle list-heads "$W/bundles/fixture.bundle")"
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
      as . claude plugin list
      ;;
    configs)
      node "$r2/configs.mjs" "$R" "$r1/as-e2e.mjs" > "$W/bases.json"
      cat "$W/bases.json"
      ;;
    trust)
      # On a variant branch, so init finds squeal.config.json and writes nothing in the clone.
      as fixture git checkout -q fix-h2
      as fixture squeal init --harness codex --trust --yes
      as fixture git status --short
      as fixture git checkout -q dogfood
      ;;
    cleanup)
      for repo in cezarion fixture; do
        as "$repo" squeal stop || true
        node "$r1/mem.mjs" "$R/$repo"
      done
      ps -u squeal-e2e -o pid,etime,cmd || echo "no process of squeal-e2e"
      ;;
    *) echo "unknown step $step"; exit 2 ;;
  esac
done
