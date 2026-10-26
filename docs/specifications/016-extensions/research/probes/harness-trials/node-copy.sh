#!/bin/sh
# Throwaway probe (016-35). Run as squeal-e2e with HOME=/home/squeal-e2e.
# Makes ~/ht035/squeal-node/plugins/pi, a copy of the 0.1.335 Pi package whose
# delivery worker names $HT_NODE (else process.execPath) at its two uses: the
# daemon spawn and the CLI command in Squeal's texts. The original copy and
# Squeal's source are untouched. Prints both lines after the change.
set -eu
src=$HOME/ht035/squeal/plugins/pi
dst=$HOME/ht035/squeal-node/plugins/pi
mkdir -p "$dst"
cp -R "$src/." "$dst/"
sed -i 's/spawn2(process\.execPath, \[cli, "daemon"/spawn2(process.env.HT_NODE || process.execPath, [cli, "daemon"/; s/function piCommand(cli, node = process\.execPath)/function piCommand(cli, node = process.env.HT_NODE || process.execPath)/' "$dst/dist/worker.mjs"
grep -n 'HT_NODE' "$dst/dist/worker.mjs"
