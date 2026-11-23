#!/bin/sh
# Throwaway probe for 023-69 (023-28's deploy.sh). Not product code. Runs on the worker's host,
# never on the VM. The sessions run on the lab VM (allowed for round 9 by the human, 2026-11-23, wave-33 brief).
#   LAB=<user@vm> TASK=<task id> sh deploy.sh inputs|copy|fetch
#     inputs  builds the VM's inputs in $SCRATCH/in: hub.bundle (the private hub at 7b44459, the
#             0.1.610 entry, read with this user's gh), squawk.bundle (~/projects/cezar read only,
#             history to 0dfe0724c, through a local bare clone), install.sh (git show
#             squeal--v0.1.610:install.sh)
#     copy    makes ~/work/$TASK/{bin,in,logs} on the VM and copies this folder, 023-10's
#             timeline.mjs, and the inputs there
#     fetch   copies the VM's logs back to $SCRATCH/logs, without transcript.jsonl and
#             stream.jsonl (they are deleted with the work folder)
# LAB is the ssh target: it is never written into this repository.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
: "${LAB:?LAB=<user@vm>}" "${TASK:?TASK=<task id>}"
SCRATCH=${SCRATCH:-$HOME/projects/squeal/.ai/squawk/t/${TASK%%-*}/w33}
WT=$(cd "$here/../../../../../.." && pwd)
CEZ=$HOME/projects/cezar
HUB=7b44459
TAG=squeal--v0.1.610
SQUAWK=0dfe0724cbf81ddc5b7cf7382ac717aea8c829bb
remote="~/work/$TASK"
case "${1:-}" in
  inputs)
    mkdir -p "$SCRATCH/in"
    rm -rf "$SCRATCH/hub-src" "$SCRATCH/squawk.git"
    gh repo clone hearsay-tools/marketplace "$SCRATCH/hub-src" -- -q
    git -C "$SCRATCH/hub-src" checkout -q "$HUB"
    git -C "$SCRATCH/hub-src" log --oneline -1
    git -C "$SCRATCH/hub-src" bundle create "$SCRATCH/in/hub.bundle" HEAD
    rm -rf "$SCRATCH/hub-src"
    git clone -q --bare "$CEZ" "$SCRATCH/squawk.git"
    git -C "$SCRATCH/squawk.git" update-ref refs/heads/w33 "$SQUAWK"
    git -C "$SCRATCH/squawk.git" symbolic-ref HEAD refs/heads/w33
    git -C "$SCRATCH/squawk.git" bundle create "$SCRATCH/in/squawk.bundle" w33
    rm -rf "$SCRATCH/squawk.git"
    git -C "$WT" show "$TAG:install.sh" > "$SCRATCH/in/install.sh"
    ls -la "$SCRATCH/in"
    ;;
  copy)
    ssh -o BatchMode=yes "$LAB" "mkdir -p $remote/bin $remote/in $remote/logs"
    scp -q "$here"/* "$here/../../023-10/bin/timeline.mjs" "$LAB:$remote/bin/"
    scp -q "$SCRATCH/in/hub.bundle" "$SCRATCH/in/squawk.bundle" "$SCRATCH/in/install.sh" "$LAB:$remote/in/"
    ssh -o BatchMode=yes "$LAB" "ls -la $remote/bin $remote/in"
    ;;
  fetch)
    mkdir -p "$SCRATCH/logs"
    rsync -a --exclude transcript.jsonl --exclude stream.jsonl "$LAB:$remote/logs/" "$SCRATCH/logs/"
    ;;
  *) echo "usage: LAB=<user@vm> TASK=<task id> sh deploy.sh inputs|copy|fetch"; exit 2 ;;
esac
