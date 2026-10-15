#!/bin/sh
# Copies the condensed record of each session into logs/ here: a timeline per session from the
# proxy log (condense.py), the counts (stats.py), Cezar's events condensed, and the install,
# setup, update, run and TUI transcripts. Raw request logs and OpenCode's database stay in
# dogfood-008 (they hold whole system prompts and file contents; no key).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
D=/home/squeal-e2e/dogfood-008
mkdir -p "$here/logs"
as() { sudo -n -u squeal-e2e "$@"; }
names=$(as sh -c "cd $D/logs && ls *.requests.jsonl 2>/dev/null" | sed 's/\.requests\.jsonl$//')
for s in $names; do
  as python3 -I "$D/scripts/condense.py" "$s" >"$here/logs/$s.timeline.md"
done
[ -z "$names" ] || as python3 -I "$D/scripts/stats.py" $names >"$here/logs/stats.txt"
for f in $(as sh -c "cd $D/logs && ls *.txt *.run.jsonl *.run.err 2>/dev/null"); do
  case $f in npm-ci.txt) continue ;; esac
  as cat "$D/logs/$f" >"$here/logs/$f"
done
for f in $(as sh -c "cd $D/logs && ls *.events.jsonl 2>/dev/null"); do
  as python3 -I "$D/scripts/events.py" "$D/logs/$f" >"$here/logs/${f%.events.jsonl}.cezar-events.txt"
done
ls -l "$here/logs"
