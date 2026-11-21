#!/bin/bash
# usage: run-export.sh <plugin dir> <out name> [extra node flags]
set -u
export PATH=/home/user/node26/bin:$PATH
P=$1; NAME=$2; shift 2
cd /home/user/squawk
set -- "$@"
PARTS=$(ls -d /home/user/parts/squeal-parts-shard-*; for s in package scripts; do [ -d /home/user/parts/squeal-parts-node-test/$s ] && echo /home/user/parts/squeal-parts-node-test/$s; done)
mkdir -p /home/user/out
start=$(date +%s.%N)
node --disable-warning=ExperimentalWarning "$@" $P/dist/cli/squeal.mjs ci export --parts $PARTS --out /home/user/out/$NAME.json.gz > /home/user/out/$NAME.stdout 2> /home/user/out/$NAME.stderr
code=$?
end=$(date +%s.%N)
echo "$NAME exit=$code seconds=$(echo "$end - $start" | bc)" | tee -a /home/user/out/times.txt
