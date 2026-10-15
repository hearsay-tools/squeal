#!/bin/sh
# One Cezar-shaped serve session (cezar-drive.mjs) from a scenario, as squeal-e2e.
# Usage: sh serve.sh <name> <scenario file under scenarios/>
set -eu
D=/home/squeal-e2e/dogfood-008
exec sudo -n -u squeal-e2e -H sh "$D/scripts/as-user.sh" -C / node "$D/scripts/cezar-drive.mjs" "$D/scripts/scenarios/$2" "$D/logs/$1.events.jsonl"
