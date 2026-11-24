#!/bin/sh
# Throwaway probe for research 025-12 (D12): what an agent sees after D20's idle close.
# Runs in a scratch clone whose daemon has settled, with runner.hostIdleMinutes 1 in its
# squeal.config.json. Per trial: a warm edit (the fast host is up), then a wait past the
# idle close, a check that no Vitest runner host is left, and a cold edit. Each edit appends
# a comment to <test file> and times `squeal status --wait 60000 <test file>` through the
# shipped wrapper. One JSON line per edit. The file is restored at the end.
#   sh host-idle-e2e.sh <root> <plugin dir> <test file> <trials> <idle wait seconds>
set -eu
root=$1 plugin=$2 file=$3 trials=$4 idle=$5
cd "$root"
cp "$file" "$file.probe-orig"
trap 'mv "$file.probe-orig" "$file"' EXIT
hosts() { pgrep -fc -- "runner-host $root --runner vitest" || true; }
ms() { date +%s%3N; }
edit() {
  kind=$1 n=$2
  before=$(hosts)
  printf '\n// probe 025-12 %s %s\n' "$kind" "$n" >>"$file"
  t0=$(ms)
  out=$(sh "$plugin/bin/squeal" status --wait 60000 "$file" 2>&1 | tr '\n' ' ' | cut -c1-200)
  t1=$(ms)
  printf '{"kind":"%s","trial":%s,"waitMs":%s,"hostsBefore":%s,"hostsAfter":%s,"load1":"%s","out":"%s"}\n' \
    "$kind" "$n" $((t1 - t0)) "$before" "$(hosts)" "$(cut -d' ' -f1 /proc/loadavg)" "$(printf %s "$out" | tr -d '"\\')"
}
# One edit first so the fast host is up before the first warm trial.
edit prime 0
sleep 5
i=1
while [ "$i" -le "$trials" ]; do
  edit warm "$i"
  sleep "$idle"
  edit cold "$i"
  sleep 5
  i=$((i + 1))
done
