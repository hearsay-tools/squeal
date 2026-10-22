#!/bin/bash
# Replays the human's vim sequence on the clone: swap file appears, changes, then the
# file is written and the swap file removed. $1 = "edit" or "revert". Prints UTC times.
cd /tmp/el115/clone/plugin-tools/estimate-pricing/estimate_pricing
ts() { date -u +%H:%M:%S.%N | cut -c1-12; }
echo "$(ts) swp create"; head -c 4096 /dev/urandom > .cli.py.swp
sleep 3; echo "$(ts) swp change"; head -c 4096 /dev/urandom > .cli.py.swp
sleep 10
if [ "$1" = edit ]; then echo "# squeal-probe" >> cli.py; else git -C /tmp/el115/clone checkout -q -- plugin-tools/estimate-pricing/estimate_pricing/cli.py; fi
echo "$(ts) cli.py written ($1)"; rm -f .cli.py.swp; echo "$(ts) swp removed"
