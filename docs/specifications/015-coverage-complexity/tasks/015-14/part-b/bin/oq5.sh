#!/bin/sh
# 015-14 part B, open question 5: two runs of one test-file list at the same
# content, in a reflink copy of the 0.1.349 clone with a scratch HOME, after
# the load gate; the one-minute load is logged at each run's start and end.
# Usage: oq5.sh <list> <log> <deadline, epoch seconds> [<label>]
B=/tmp/dogfood-015-14/w-327524f0
list=$1; log=$2; deadline=$3; label=${4:-oq5}
sh "$B/bin/gate.sh" "$label" "$log" "$deadline" || exit 2
R=$B/runs/$label
rm -rf "$R" "$R.home"
cp -a --reflink=always "$B/tmpl" "$R"
mkdir -p "$R.home/run" "$R.home/tmp" "$R.home/config" "$R.home/cache"
chmod 700 "$R.home/run"
for run in a b; do
  mkdir -p "$R.home/tmp/$run"
  echo "$(date -u +%FT%TZ) $label run $run starts at load $(cut -d' ' -f1 /proc/loadavg)" >> "$log"
  (cd "$R" && env -i PATH="$PATH" HOME="$R.home" XDG_RUNTIME_DIR="$R.home/run" TMPDIR="$R.home/tmp" \
    XDG_CONFIG_HOME="$R.home/config" XDG_CACHE_HOME="$R.home/cache" \
    node_modules/.bin/tsx "$B/bin/oq5.mts" "$R" "$R" "$list" "$R.home/tmp/$run" "$B/out/$label-$run.json") >> "$log" 2>&1
  rc=$?
  echo "$(date -u +%FT%TZ) $label run $run ends, exit $rc, at load $(cut -d' ' -f1 /proc/loadavg)" >> "$log"
done
python3 -I "$B/bin/oq5-diff.py" "$B/out/$label-a.json" "$B/out/$label-b.json" > "$B/out/$label-diff.txt" 2>&1
echo "$(date -u +%FT%TZ) $label done" >> "$log"
