#!/bin/sh
# Throwaway probe for 023-32 (after 023-28's setup.sh). Not product code. No model runs here.
# Runs in a boat.dev sandbox (its user, passwordless sudo), from a copy of this folder at <work>/bin, where <work> is
# ~/work/<task id> (deploy.sh makes both). Inputs made on the worker's host and copied to <work>/in:
# hub.bundle (the private hub at c126136, the 0.1.577 entry), squawk.bundle (squawk's history to
# 0dfe0724c), install.sh (git show squeal--v0.1.577:install.sh), 023-25's probes in <work>/bin.
# Throwaway user squeal-w18, case root /home/$U/runs/w18. Round 4's s7-01, without the session:
#   sh setup.sh <step>...
#     user     the throwaway user squeal-w18 (no password, no sudo)
#     node     Node 24.21.0 from nodejs.org, checked against SHASUMS256.txt, at /opt/squeal-w18/node24
#     dirs     the case directories; the inputs and probes copied into the case root
#     claude   Claude Code CLAUDE_VERSION (default 2.1.327) from npm: install.sh needs a harness
#     hub      the hub bundle cloned for the user as hub/
#     install  the release's install.sh with SQUEAL_MARKETPLACE=<hub clone>
#     src      squawk as a bare clone of the bundle
#     probesrc Squeal's source at SQUEAL_TAG (default squeal--v0.1.577) from github.com, installed
#              and built, so the probes can import its dist/ (the same code as the release)
#     prepare <id>   round 4's s7: a fresh clone (--no-checkout, checkout -B main 8be977ad6), its own
#              pnpm install, squeal start, squeal run --all --wait, squeal stop; then the clone's
#              ignored files and the store's keys for the file (state/<id>.prepare.txt)
#     compare <id>   round 4's first call, daemon stopped: squeal status --at 8be977ad6 --run, then
#              the same without --run and with --json for the file (state/<id>.compare.txt)
#     probe <id>     023-25's probes in the clone: key inputs on both sides, the store's keys and
#              meta for the file (state/<id>.probe.json and .txt)
#     leftover       every process of the user, and its /tmp entries
#     teardown removes the user, its home, /opt/squeal-w18, its /tmp entries and every process of it
set -eu
here=$(cd "$(dirname "$0")" && pwd)
W=$(dirname "$here")
U=squeal-w18
R=/home/$U/runs/w18
NODE_V=24.21.0
CLAUDE_VERSION=${CLAUDE_VERSION:-2.1.327}
SQUEAL_TAG=${SQUEAL_TAG:-squeal--v0.1.577}
COMMIT=8be977ad6
FILE=packages/cezar/src/home/runtime-cli.test.ts
as() { dir=$1; shift; node "$here/as-user.mjs" "$R" "$R/$dir" "$@"; }
u() { sudo -n -u "$U" "$@"; }
out() { mkdir -p "$W/state"; tee -a "$W/state/$1"; }

step=$1
shift
echo "== $step $* $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)"
case "$step" in
  user)
    id "$U" >/dev/null 2>&1 || sudo -n useradd --create-home --shell /bin/bash "$U"
    sudo -n chmod 750 "/home/$U"
    id "$U"
    ;;
  node)
    cd "$W/in"
    f=node-v$NODE_V-linux-x64.tar.xz
    curl -fsSLO "https://nodejs.org/dist/v$NODE_V/$f"
    curl -fsSLO "https://nodejs.org/dist/v$NODE_V/SHASUMS256.txt"
    grep " $f\$" SHASUMS256.txt | sha256sum -c -
    sudo -n rm -rf "/opt/$U"
    sudo -n mkdir -p "/opt/$U"
    sudo -n tar -xJf "$f" -C "/opt/$U"
    sudo -n mv "/opt/$U/node-v$NODE_V-linux-x64" "/opt/$U/node24"
    as . node --version
    ;;
  dirs)
    u mkdir -p "$R/home" "$R/tmp" "$R/codex" "$R/claude" "$R/xdg" "$R/evals" "$R/bin" "$R/corepack" "$R/pnpm-store" "$R/src" "$R/npm"
    sudo -n rm -rf "$R/in" "$R/probes"
    sudo -n mkdir "$R/in" "$R/probes"
    sudo -n cp "$W/in/hub.bundle" "$W/in/squawk.bundle" "$W/in/install.sh" "$R/in/"
    sudo -n cp "$here/probe.mjs" "$here/keys.mjs" "$here/meta.mjs" "$R/probes/"
    sudo -n chown -R "$U:$U" "$R/in" "$R/probes"
    ;;
  claude)
    as . npm install -g --prefix "$R/npm" --no-fund --no-audit "@anthropic-ai/claude-code@$CLAUDE_VERSION"
    u ln -sf "$R/npm/bin/claude" "$R/bin/claude"
    as . claude --version
    ;;
  hub)
    u rm -rf "$R/hub"
    as . git clone -q "$R/in/hub.bundle" hub
    as hub git log --oneline -1
    ;;
  install)
    as . corepack enable --install-directory "$R/bin" pnpm
    E2E_VAR_SQUEAL_MARKETPLACE="$R/hub" as . sh "$R/in/install.sh"
    as . squeal --version
    as . claude plugin list
    ;;
  src)
    u rm -rf "$R/src/squawk"
    as src git clone -q --bare "$R/in/squawk.bundle" squawk
    as src/squawk git cat-file -t 0dfe0724c
    ;;
  probesrc)
    u rm -rf "$R/src/squeal"
    as src git clone -q --depth 1 --branch "$SQUEAL_TAG" https://github.com/hearsay-tools/squeal.git squeal
    as src/squeal pnpm install --frozen-lockfile --reporter=silent
    as src/squeal pnpm exec tsrs --fast -p tsconfig.build.json
    as src/squeal ls dist/core/commit/at-keys-walk.js
    ;;
  prepare)
    id=$1
    u rm -rf "$R/$id"
    as . git clone -q --no-checkout "$R/src/squawk" "$id"
    as "$id" git -c advice.detachedHead=false checkout -q -B main "$COMMIT"
    as "$id" git config user.name "Dana User"
    as "$id" git config user.email dana@example.invalid
    as "$id" pnpm install --frozen-lockfile --reporter=silent
    {
      as "$id" squeal --version
      as "$id" squeal start >/dev/null
      as "$id" squeal run --all --wait || echo "warm-up exit $?"
      as "$id" squeal status | head -5
      as "$id" squeal stop
      as "$id" git log --oneline -2
      echo "-- git status (untracked and ignored, outside node_modules)"
      as "$id" git status --short --ignored | grep -v node_modules || true
      echo "-- store keys of $FILE"
      as . node probes/keys.mjs "$R/$id/.git/squeal/store.sqlite" "$FILE" || true
    } 2>&1 | out "$id.prepare.txt"
    ;;
  compare)
    id=$1
    {
      as "$id" squeal status --at "$COMMIT" --run || echo "exit $?"
      echo ----
      as "$id" squeal status --at "$COMMIT" "$FILE" || echo "exit $?"
      echo ----
      as "$id" squeal status --at "$COMMIT" "$FILE" --json || echo "exit $?"
    } 2>&1 | out "$id.compare.txt"
    ;;
  probe)
    id=$1
    {
      as . node probes/probe.mjs "$R/src/squeal" "$R/$id" "$COMMIT" server "$FILE" "$R/probes/$id.probe.json" || echo "probe exit $?"
      as . node probes/keys.mjs "$R/$id/.git/squeal/store.sqlite" "$FILE" || true
      as . node probes/meta.mjs "$R/$id/.git/squeal/store.sqlite" "$FILE" || true
    } 2>&1 | out "$id.probe.txt"
    sudo -n cp "$R/probes/$id.probe.json" "$W/state/" 2>/dev/null || true
    sudo -n chown -R "$(id -u):$(id -g)" "$W/state"
    ;;
  leftover)
    ps -u "$U" -o pid,etime,pcpu,args || echo "no process of $U"
    sudo -n find /tmp -maxdepth 1 -user "$U" | wc -l
    ;;
  teardown)
    sudo -n pkill -KILL -u "$U" || true
    sleep 1
    sudo -n find /tmp -maxdepth 1 -user "$U" -exec rm -rf {} + 2>/dev/null || true
    sudo -n userdel --remove "$U" 2>/dev/null || true
    sudo -n rm -rf "/home/$U" "/opt/$U"
    id "$U" 2>/dev/null || echo "user $U removed"
    ps -u "$U" 2>/dev/null || echo "no process of $U"
    ;;
  *) echo "unknown step $step"; exit 2 ;;
esac
