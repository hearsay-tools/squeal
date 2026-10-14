#!/usr/bin/env bash
# THROWAWAY: copy this probe into the squeal-e2e home and run scenarios there as squeal-e2e.
# usage: go.sh <scenario>...    then: go.sh --cat <scenario> <file>
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
E2E=(sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e PATH=/home/squeal-e2e/.npm-global/bin:/opt/squeal-e2e/node24/bin:/usr/bin:/bin)
if [ "$1" = --cat ]; then "${E2E[@]}" cat "/home/squeal-e2e/pee/out/$2/$3"; exit; fi
tar -C "$HERE" --exclude=results -cf - probe.ts rpc-drive.mjs sock-server.mjs sc.sh plans steps \
  | "${E2E[@]}" bash -c 'mkdir -p /home/squeal-e2e/pee/probe && cd /home/squeal-e2e/pee/probe && tar -xf -'
for sc in "$@"; do "${E2E[@]}" bash -c "cd / && bash /home/squeal-e2e/pee/probe/sc.sh $sc" </dev/null; done
