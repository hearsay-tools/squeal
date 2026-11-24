#!/bin/sh
# Throwaway probe for 023-80 (023-28's setup.sh). Not product code. No model runs here. Runs on
# the lab VM as its user agent (passwordless sudo), from a copy of this folder at <work>/bin,
# where <work> is ~/work/<task id> (deploy.sh makes both). Inputs made on the worker's host and copied to <work>/in: hub.bundle (the private hub at
# 8966745, the 0.1.614 entry), squawk.bundle (squawk's history to 0dfe0724c), install.sh (the
# release's own, git show squeal--v0.1.614:install.sh). Throwaway user squeal-w37, case root
# /home/$U/runs/w37 (U=squeal-w37); step dirs copies the inputs into its in/.
#   sh setup.sh <step>...
#     user     the throwaway user squeal-w37 (no password, no sudo)
#     node     Node 24.21.0 from nodejs.org, checked against SHASUMS256.txt, at /opt/squeal-w37/node24
#     dirs     the case directories
#     claude   Claude Code CLAUDE_VERSION (default 2.1.327, round 4's) from npm into the case root
#     hub      the hub bundle cloned for the user as hub/
#     install  the release's install.sh with SQUEAL_MARKETPLACE=<hub clone>; Claude Code fetches the
#              plugin from public github.com at the hub's pinned tag, as a user's install does
#     src      squawk as a bare clone of the bundle; Squeal at 20f03a431 (depth 50) from github.com
#     prepare <id>   one session's fresh clone: s<g>-<nn>, group g as in prompts.json (s1 squawk,
#              s2 Squeal); its own pnpm install; the store stays empty
#     remove <id>    removes a session's clone, unless <work>/KEEP-<id> exists
#     dry            the dry check without a model: a scratch squawk clone, squeal --version,
#              squeal start, status, stop, and the user's processes after; then removed
#     dryat          round 6: the commit daemon without a model: a scratch squawk clone, squeal
#              start, status --at HEAD~1 --run, squeal ps and the checkout folders, squeal stop,
#              squeal ps again, squeal stop --at HEAD~1, leftover; then removed
#     leftover       every process of the user (pid, cwd, command line), and its /tmp entries
#     teardown removes the user, its home, /opt/squeal-w37, its /tmp entries and every process
set -eu
here=$(cd "$(dirname "$0")" && pwd)
W=$(dirname "$here")
U=squeal-w37
R=/home/$U/runs/w37
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
    mkdir -p "$W/logs"
    # The user cannot read agent's home: its inputs are copied into the case root.
    sudo -n rm -rf "$R/in"
    sudo -n mkdir "$R/in"
    sudo -n cp "$W/in/hub.bundle" "$W/in/squawk.bundle" "$W/in/install.sh" "$R/in/"
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
      s1-*|s1b-*) squawk_at "$id" 8be977ad6 ;;
      s2-*) squeal_at "$id" ;;
      *) echo "unknown session $id"; exit 2 ;;
    esac
    as "$id" git config user.name "Dana User"
    as "$id" git config user.email dana@example.invalid
    as "$id" pnpm install --frozen-lockfile --reporter=silent
    as "$id" git log --oneline -2
    as "$id" git status --short
    ;;
  browser-allow)
    # Round 8 (023-63): Ubuntu 24.04 sets kernel.apparmor_restrict_unprivileged_userns=1, so the
    # Chrome for Testing that agent-browser downloads into the user's home dies with "No usable
    # sandbox". This profile, shaped as Ubuntu's own /etc/apparmor.d/chrome (unconfined, userns),
    # lets only that path use user namespaces. browser-remove takes it out again.
    f=/etc/apparmor.d/$U-chrome
    printf '%s\n' 'abi <abi/4.0>,' 'include <tunables/global>' \
      "profile $U-chrome /home/$U/runs/w37/home/.agent-browser/browsers/chrome-*/chrome flags=(unconfined) {" \
      '  userns,' '}' | sudo -n tee "$f" >/dev/null
    sudo -n apparmor_parser -r "$f"
    sudo -n cat /sys/kernel/security/apparmor/profiles | grep "$U-chrome"
    ;;
  browser-remove)
    f=/etc/apparmor.d/$U-chrome
    if [ -e "$f" ]; then sudo -n apparmor_parser -R "$f" || true; sudo -n rm -f "$f"; fi
    sudo -n rm -rf "/home/$U/runs/w37/home/.agent-browser" "/home/$U/runs/w37/home/.cache/agent-tools"
    sudo -n grep -c "$U-chrome" /sys/kernel/security/apparmor/profiles || echo "profile $U-chrome removed"
    ;;
  browser)
    # Round 8 (023-63): prove one browser file runs as the user, through squawk's own wrapper
    # (`pnpm run test:e2e -- <spec>`), which downloads agent-browser and its Chrome into the
    # user's cache. No Squeal here, so no store is seeded. The clone stays for a rerun; `remove brw`.
    # Round 9 (023-69): the spec is passed without `--` (round 8's `-- <spec>` reached Vitest after
    # its own `--`, so the filter was ignored and every spec ran), under timeout 900.
    spec=${1:-thread-scroll.e2e.ts}
    if [ ! -d "$R/brw" ]; then
      squawk_at brw 8be977ad6
      as brw git config user.name "Dana User"
      as brw git config user.email dana@example.invalid
      as brw pnpm install --frozen-lockfile --reporter=silent
    fi
    t0=$(date +%s)
    as brw timeout --kill-after=30 900 pnpm run test:e2e "$spec" || echo "exit $?"
    echo "test:e2e $spec took $(( $(date +%s) - t0 )) s"
    ;;
  remove)
    if [ -e "$W/KEEP-$1" ]; then echo "kept $1 ($W/KEEP-$1)"; exit 0; fi
    u rm -rf "${R:?}/$1"
    ;;
  dry)
    squawk_at dry 8be977ad6
    as dry git config user.name "Dana User"
    as dry git config user.email dana@example.invalid
    as dry pnpm install --frozen-lockfile --reporter=silent
    as dry squeal --version
    as dry squeal start
    as dry squeal status --wait 60000 | head -8 || true
    as dry squeal stop
    sleep 2
    sh "$here/setup.sh" leftover
    u rm -rf "${R:?}/dry"
    ;;
  dryat)
    squawk_at dryat 8be977ad6
    as dryat git config user.name "Dana User"
    as dryat git config user.email dana@example.invalid
    as dryat pnpm install --frozen-lockfile --reporter=silent
    as dryat squeal start
    t0=$(date +%s)
    as dryat squeal status --at HEAD~1 --run || true
    echo "status --at took $(( $(date +%s) - t0 )) s"
    as dryat squeal ps || true
    as . sh -c 'find home/.cache/squeal/checkouts -maxdepth 3 | head -30; find dryat/.git/squeal -maxdepth 3 2>/dev/null | head'
    as dryat squeal stop
    sleep 2
    echo "== after squeal stop"
    as dryat squeal ps || true
    as dryat squeal stop --at HEAD~1 || true
    sleep 2
    echo "== after squeal stop --at HEAD~1"
    as dryat squeal ps || true
    as . sh -c 'find home/.cache/squeal/checkouts -maxdepth 3 | head -30'
    sh "$here/setup.sh" leftover
    u rm -rf "${R:?}/dryat"
    ;;
  leftover)
    for p in $(pgrep -u "$U" || true); do
      printf '%s\t%s\t%s\n' "$p" "$(sudo -n readlink "/proc/$p/cwd" 2>/dev/null)" \
        "$(sudo -n tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | cut -c1-200)"
    done
    echo "processes of $U: $(pgrep -u "$U" | wc -l)"
    echo "/tmp entries of $U: $(sudo -n find /tmp -maxdepth 1 -user "$U" | wc -l)"
    ;;
  teardown)
    sudo -n pkill -KILL -u "$U" || true
    sleep 1
    sudo -n find /tmp -maxdepth 1 -user "$U" -exec rm -rf {} + 2>/dev/null || true
    sudo -n userdel --remove "$U" 2>/dev/null || true
    sudo -n rm -rf "/home/$U" "/opt/$U"
    id "$U" 2>/dev/null || echo "user $U removed"
    pgrep -u "$U" 2>/dev/null || echo "no process of $U"
    ;;
  *) echo "unknown step $step"; exit 2 ;;
esac
