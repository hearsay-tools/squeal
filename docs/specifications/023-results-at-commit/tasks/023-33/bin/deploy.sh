#!/bin/sh
# Throwaway probe for 023-33 (023-28's deploy.sh, with 023-32's boat.dev transport). Not product
# code. Runs on the worker's host, never in the sandbox. The sessions run in a boat.dev sandbox
# this worker created (`boat new`); BOX is its id, never written into this repository.
#   BOX=<sandbox id> TASK=<task id> sh deploy.sh inputs|copy|fetch
#     inputs  builds the sandbox's inputs in $SCRATCH/in: hub.bundle (the private hub at cf42b11, the
#             0.1.584 entry, read with this user's gh), squawk.bundle (~/projects/cezar read only,
#             history to 0dfe0724c, through a local bare clone), install.sh (git show
#             squeal--v0.1.584:install.sh)
#     copy    makes /home/user/work/$TASK/{bin,in,logs} in the sandbox; copies this folder,
#             023-10's timeline.mjs and the inputs there
#     fetch   copies the sandbox's logs back to $SCRATCH/logs, without transcript.jsonl and
#             stream.jsonl (they stay in the sandbox until it is deleted)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
: "${BOX:?BOX=<sandbox id>}" "${TASK:?TASK=<task id>}"
SCRATCH=${SCRATCH:-$HOME/projects/squeal/.ai/squawk/t/${TASK%%-*}/w19}
WT=$(cd "$here/../../../../../.." && pwd)
CEZ=$HOME/projects/cezar
HUB=cf42b11
TAG=squeal--v0.1.584
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
    git -C "$SCRATCH/squawk.git" update-ref refs/heads/w19 "$SQUAWK"
    git -C "$SCRATCH/squawk.git" symbolic-ref HEAD refs/heads/w19
    git -C "$SCRATCH/squawk.git" bundle create "$SCRATCH/in/squawk.bundle" w19
    rm -rf "$SCRATCH/squawk.git"
    git -C "$WT" show "$TAG:install.sh" > "$SCRATCH/in/install.sh"
    ls -la "$SCRATCH/in"
    ;;
  copy)
    boat ssh "$BOX" -- "mkdir -p $remote/bin $remote/in $remote/logs"
    for f in "$here"/* "$here/../../023-10/bin/timeline.mjs"; do boat scp "$f" "$BOX:$remote/bin/"; done
    for f in hub.bundle squawk.bundle install.sh; do boat scp "$SCRATCH/in/$f" "$BOX:$remote/in/"; done
    boat ssh "$BOX" -- "ls -la $remote/bin $remote/in"
    ;;
  fetch)
    mkdir -p "$SCRATCH/logs"
    boat ssh "$BOX" -- "cd $remote && tar --exclude=transcript.jsonl --exclude=stream.jsonl -czf /tmp/logs-$TASK.tgz logs"
    boat scp "$BOX:/tmp/logs-$TASK.tgz" "$SCRATCH/"
    tar -xzf "$SCRATCH/logs-$TASK.tgz" -C "$SCRATCH"
    ;;
  *) echo "usage: BOX=<sandbox id> TASK=<task id> sh deploy.sh inputs|copy|fetch"; exit 2 ;;
esac
