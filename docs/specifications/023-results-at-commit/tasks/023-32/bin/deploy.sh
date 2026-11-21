#!/bin/sh
# Throwaway probe for 023-32 (after 023-28's deploy.sh). Not product code. Runs on the worker's
# host, never in the sandbox. The heavy part runs in a boat.dev sandbox this worker created
# (`boat new`); BOX is its id, never written into this repository.
#   BOX=<sandbox id> TASK=<task id> sh deploy.sh inputs|copy|fetch
#     inputs  builds the sandbox's inputs in $SCRATCH/in: hub.bundle (the private hub at c126136, read
#             with this user's gh), squawk.bundle (~/projects/cezar read only, history to
#             0dfe0724c, through a local bare clone), install.sh (git show squeal--v0.1.577)
#     copy    makes ~/work/$TASK/{bin,in,state} in the sandbox; copies this folder, 023-25's
#             probes and the inputs there
#     fetch   copies the sandbox's state/ back to $SCRATCH/state
set -eu
here=$(cd "$(dirname "$0")" && pwd)
: "${BOX:?BOX=<sandbox id>}" "${TASK:?TASK=<task id>}"
SCRATCH=${SCRATCH:-$HOME/projects/squeal/.ai/squawk/t/${TASK%%-*}/w18}
WT=$(cd "$here/../../../../../.." && pwd)
CEZ=$HOME/projects/cezar
HUB=c126136
SQUAWK=0dfe0724cbf81ddc5b7cf7382ac717aea8c829bb
remote="/home/user/work/$TASK"
case "${1:-}" in
  inputs)
    mkdir -p "$SCRATCH/in"
    rm -rf "$SCRATCH/hub-src" "$SCRATCH/squawk.git"
    gh repo clone hearsay-tools/marketplace "$SCRATCH/hub-src" -- -q
    git -C "$SCRATCH/hub-src" checkout -q "$HUB"
    git -C "$SCRATCH/hub-src" bundle create "$SCRATCH/in/hub.bundle" HEAD
    rm -rf "$SCRATCH/hub-src"
    git clone -q --bare "$CEZ" "$SCRATCH/squawk.git"
    git -C "$SCRATCH/squawk.git" update-ref refs/heads/w18 "$SQUAWK"
    git -C "$SCRATCH/squawk.git" symbolic-ref HEAD refs/heads/w18
    git -C "$SCRATCH/squawk.git" bundle create "$SCRATCH/in/squawk.bundle" w18
    rm -rf "$SCRATCH/squawk.git"
    git -C "$WT" show squeal--v0.1.577:install.sh > "$SCRATCH/in/install.sh"
    ls -la "$SCRATCH/in"
    ;;
  copy)
    boat ssh "$BOX" -- "mkdir -p $remote/bin $remote/in $remote/state"
    for f in "$here"/* "$here/../../023-25/bin/probe.mjs" "$here/../../023-25/bin/keys.mjs" \
      "$here/../../023-25/bin/meta.mjs"; do boat scp "$f" "$BOX:$remote/bin/"; done
    for f in hub.bundle squawk.bundle install.sh; do boat scp "$SCRATCH/in/$f" "$BOX:$remote/in/"; done
    boat ssh "$BOX" -- "ls -la $remote/bin $remote/in"
    ;;
  fetch)
    mkdir -p "$SCRATCH/state"
    boat scp -r "$BOX:$remote/state" "$SCRATCH/"
    ;;
  *) echo "usage: BOX=<sandbox id> TASK=<task id> sh deploy.sh inputs|copy|fetch"; exit 2 ;;
esac
