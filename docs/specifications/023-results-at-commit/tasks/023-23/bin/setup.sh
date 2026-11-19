#!/bin/sh
# Throwaway probe for 023-23 (after 023-10's setup.sh). Not product code. No model runs here.
# Runs on the lab VM as its user agent, from a copy of this folder at <work>/bin, where <work> is
# ~/work/<task id> (deploy.sh makes both). Inputs made on the worker's host and copied to <work>/in:
# hub.bundle (the private hub at d84397e), squawk.bundle (squawk's history to 0dfe0724c),
# install.sh (the release's own, git show squeal--v0.1.568:install.sh). Throwaway user squeal-w15,
# case root /home/squeal-w15/runs/w15; step dirs copies the inputs and fixtures into its in/.
#   sh setup.sh <step>...
#     user     the throwaway user squeal-w15 (no password, no sudo)
#     node     Node 24.21.0 from nodejs.org, checked against SHASUMS256.txt, at /opt/squeal-w15/node24
#     dirs     the case directories
#     claude   Claude Code CLAUDE_VERSION (default the VM's own, 2.1.327) from npm into the case root
#     hub      the hub bundle cloned for the user as hub/
#     install  the release's install.sh with SQUEAL_MARKETPLACE=<hub clone>; Claude Code fetches the
#              plugin from public github.com at the hub's pinned tag, as a user's install does
#     src      squawk as a bare clone of the bundle; Squeal at 20f03a431 (depth 50) from github.com
#     prepare <id>   one session's fresh clone: s<g>-<nn>, group g as in prompts.json; its own
#              pnpm install; s5's fixture commits, s6's uncommitted bug; s7: squeal start, then
#              squeal run --all --wait, then squeal stop (the store holds HEAD's results)
#     remove <id>    removes a session's clone
#     teardown removes the user, its home, /opt/squeal-w15 and every process of the user
set -eu
here=$(cd "$(dirname "$0")" && pwd)
W=$(dirname "$here")
U=squeal-w15
R=/home/$U/runs/w15
NODE_V=24.21.0
CLAUDE_VERSION=${CLAUDE_VERSION:-2.1.327}
as() { dir=$1; shift; node "$here/as-user.mjs" "$R" "$R/$dir" "$@"; }
u() { sudo -n -u "$U" "$@"; }

squawk_at() { # <clone> <commit>
  u rm -rf "$R/$1"
  as . git clone -q --no-checkout "$R/src/squawk" "$1"
  as "$1" git -c advice.detachedHead=false checkout -q -B main "$2"
}
squeal_at() { # <clone>
  u rm -rf "$R/$1"
  as . git clone -q --no-checkout "file://$R/src/squeal" "$1"
  as "$1" git -c advice.detachedHead=false checkout -q -B main 20f03a43139ea3e99e057b32dac3db3dffbb903d
}

step=$1
shift
echo "== $step $* $(date -u +%FT%TZ) load $(cut -d' ' -f1 /proc/loadavg)"
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
    mkdir -p "$W/logs"
    # The user cannot read agent's home: its inputs are copied into the case root.
    sudo -n rm -rf "$R/in"
    sudo -n mkdir "$R/in"
    sudo -n cp "$W/in/hub.bundle" "$W/in/squawk.bundle" "$W/in/install.sh" "$here/fixture-s5.mjs" "$here/fixture-s6.mjs" "$R/in/"
    sudo -n chown -R "$U:$U" "$R/in"
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
    as . claude --version
    as . claude plugin list
    ;;
  src)
    u rm -rf "$R/src/squawk" "$R/src/squeal"
    as src git clone -q --bare "$R/in/squawk.bundle" squawk
    as src/squawk git cat-file -t 0dfe0724c
    as src git init -q --bare squeal
    as src/squeal git fetch -q --depth 50 https://github.com/hearsay-tools/squeal.git 20f03a43139ea3e99e057b32dac3db3dffbb903d
    as src/squeal git update-ref refs/heads/main 20f03a43139ea3e99e057b32dac3db3dffbb903d
    ;;
  prepare)
    id=$1
    case "$id" in
      s1-*|s7-*) squawk_at "$id" 8be977ad6 ;;
      s2-*) squeal_at "$id" ;;
      s3-*) squawk_at "$id" 6414b6c20 ;;
      s4-*) squawk_at "$id" e71888f91 ;;
      s5-*|s6-*) squawk_at "$id" 0dfe0724c ;;
      *) echo "unknown session $id"; exit 2 ;;
    esac
    as "$id" git config user.name "Dana User"
    as "$id" git config user.email dana@example.invalid
    as "$id" pnpm install --frozen-lockfile --reporter=silent
    case "$id" in
      s5-*) as "$id" node "$R/in/fixture-s5.mjs" ;;
      s6-*) as "$id" node "$R/in/fixture-s6.mjs" ;;
      s7-*)
        as "$id" squeal start >/dev/null
        as "$id" squeal run --all --wait || echo "warm-up exit $?"
        as "$id" squeal status | head -5
        as "$id" squeal stop
        ;;
    esac
    as "$id" git log --oneline -2
    as "$id" git status --short
    ;;
  remove)
    u rm -rf "${R:?}/$1"
    ;;
  teardown)
    sudo -n pkill -KILL -u "$U" || true
    sudo -n userdel --remove "$U" 2>/dev/null || true
    sudo -n rm -rf "/home/$U" "/opt/$U"
    id "$U" 2>/dev/null || echo "user $U removed"
    ;;
  *) echo "unknown step $step"; exit 2 ;;
esac
