#!/bin/sh
# Throwaway probe for 023-10 (after 019-17's setup.sh). Not product code. No model runs here.
# Case root /home/squeal-e2e/runs/w12, as squeal-e2e; scratch /tmp/w12-023-10 (bundles only).
#   sh setup.sh <step>...
#     dirs     the case directories
#     hub      a bundle of the hub hearsay-tools/marketplace at c50cc3c (it is private: read with
#              this user's gh, never the e2e user's), cloned for the e2e user as hub/
#     install  the release's own install.sh (git show squeal--v0.1.563:install.sh) with
#              SQUEAL_MARKETPLACE=<hub clone>; Claude Code fetches the plugin from public
#              github.com at the hub's pinned tag, as a user's install does. No codex on PATH.
#     bundles  squawk (~/projects/cezar, read only) at 0dfe0724c
#     clones   s1 s3 s4 s5 s6 from the squawk bundle (each at its commit, branch main);
#              s2 from github.com/hearsay-tools/squeal at 20f03a431 (depth 50)
#     deps     corepack pnpm install --frozen-lockfile in each clone
#     round2   r1 to r5: the same clones again for round 2 (fresh stores), r5 with s5's fixture
#     fixtures s5: feb856667's defect as two commits on 0dfe0724c (as test/e2e/at-commit-proof.test.ts);
#              s6: an uncommitted one-line bug for the control
set -eu
here=$(cd "$(dirname "$0")" && pwd)
R=/home/squeal-e2e/runs/w12
W=/tmp/w12-023-10
WT=$(cd "$here/../../../../../.." && pwd)
CEZ=$HOME/projects/cezar
HUBSHA=c50cc3c
as() { dir=$1; shift; node "$here/as-e2e.mjs" "$R" "$R/$dir" "$@"; }
e2e() { sudo -n -u squeal-e2e "$@"; }

squawk_at() { # <clone> <commit>
  e2e rm -rf "$R/$1"
  as . git clone -q --no-checkout "$R/src/squawk" "$1"
  as "$1" git -c advice.detachedHead=false checkout -q -B main "$2"
  as "$1" git config user.name "Dana User"
  as "$1" git config user.email dana@example.invalid
  as "$1" git log --oneline -1
}

for step in "$@"; do
  echo "== $step $(date -u +%FT%TZ) load $(cut -d' ' -f1 /proc/loadavg)"
  case "$step" in
    dirs)
      e2e mkdir -p "$R/home" "$R/tmp" "$R/codex" "$R/claude" "$R/xdg" "$R/evals" "$R/bin" "$R/logs" "$R/corepack" "$R/pnpm-store" "$R/src"
      mkdir -p "$W" && chmod 755 "$W"
      ;;
    hub)
      rm -rf "$W/hub-src" "$W/hub.bundle"
      gh repo clone hearsay-tools/marketplace "$W/hub-src" -- -q
      git -C "$W/hub-src" checkout -q "$HUBSHA"
      git -C "$W/hub-src" bundle create "$W/hub.bundle" HEAD
      rm -rf "$W/hub-src"
      chmod 644 "$W/hub.bundle"
      e2e rm -rf "$R/hub"
      as . git clone -q "$W/hub.bundle" hub
      as hub git log --oneline -1
      ;;
    install)
      git -C "$WT" show squeal--v0.1.563:install.sh > "$W/install.sh" && chmod 644 "$W/install.sh"
      e2e ln -sf /home/squeal-e2e/.npm-global/bin/claude "$R/bin/claude"
      as . corepack enable --install-directory "$R/bin" pnpm
      E2E_VAR_SQUEAL_MARKETPLACE="$R/hub" as . sh "$W/install.sh"
      as . squeal --version
      as . claude --version
      as . claude plugin list
      ;;
    bundles)
      rm -f "$W/squawk.bundle"
      test "$(git -C "$CEZ" rev-parse HEAD)" = 0dfe0724cbf81ddc5b7cf7382ac717aea8c829bb && git -C "$CEZ" bundle create "$W/squawk.bundle" HEAD
      chmod 644 "$W/squawk.bundle"
      e2e rm -rf "$R/src/squawk"
      as src git clone -q --bare "$W/squawk.bundle" squawk
      ;;
    clones)
      squawk_at s1 8be977ad6
      squawk_at s3 6414b6c20
      squawk_at s4 e71888f91
      squawk_at s5 0dfe0724c
      squawk_at s6 0dfe0724c
      e2e rm -rf "$R/s2"
      as . git init -q -b main s2
      as s2 git remote add origin https://github.com/hearsay-tools/squeal.git
      as s2 git fetch -q --depth 50 origin 20f03a43139ea3e99e057b32dac3db3dffbb903d
      as s2 git -c advice.detachedHead=false checkout -q -B main FETCH_HEAD
      as s2 git config user.name "Dana User"
      as s2 git config user.email dana@example.invalid
      as s2 git log --oneline -1
      ;;
    deps)
      for c in s1 s2 s3 s4 s5 s6; do
        echo "-- $c $(date -u +%T)"
        as "$c" pnpm install --frozen-lockfile --reporter=silent
      done
      ;;
    fixtures)
      mkdir -p "$W/bin" && cp "$here"/fixture-s*.mjs "$W/bin/" && chmod -R a+rX "$W/bin"
      as s5 node "$W/bin/fixture-s5.mjs"
      as s5 git log --oneline -3
      as s6 node "$W/bin/fixture-s6.mjs"
      as s6 git status --short
      ;;
    round2)
      # Round 2: the same tasks on fresh clones (own stores), prompts with one added sentence.
      squawk_at r1 8be977ad6
      squawk_at r3 6414b6c20
      squawk_at r4 e71888f91
      squawk_at r5 0dfe0724c
      e2e rm -rf "$R/r2"
      as . git init -q -b main r2
      as r2 git remote add origin https://github.com/hearsay-tools/squeal.git
      as r2 git fetch -q --depth 50 origin 20f03a43139ea3e99e057b32dac3db3dffbb903d
      as r2 git -c advice.detachedHead=false checkout -q -B main FETCH_HEAD
      as r2 git config user.name "Dana User"
      as r2 git config user.email dana@example.invalid
      for c in r1 r2 r3 r4 r5; do as "$c" pnpm install --frozen-lockfile --reporter=silent; done
      as r5 node "$W/bin/fixture-s5.mjs"
      as r5 git log --oneline -3
      ;;
    *) echo "unknown step $step"; exit 2 ;;
  esac
done
