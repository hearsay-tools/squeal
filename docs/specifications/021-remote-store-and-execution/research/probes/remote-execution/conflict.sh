#!/usr/bin/env bash
# Throwaway (row 021-02): what each mode does when the remote copy is edited (a test that writes into the tree).
set -euo pipefail
. "$(dirname "$0")/env.sh"
for mode in one-way-safe one-way-replica two-way-safe; do
  L=$RE/local/c-$mode; rm -rf $L; mkdir -p $L; echo base > $L/a.txt
  "$RE/sshwrap/ssh" remote "rm -rf /work/c-$mode"
  mutagen sync create --name c-$mode --sync-mode $mode $L remote:/work/c-$mode >/dev/null
  mutagen sync flush c-$mode >/dev/null
  "$RE/sshwrap/ssh" remote "echo remote-edit > /work/c-$mode/a.txt; echo generated > /work/c-$mode/gen.txt"
  echo local-edit > $L/a.txt
  mutagen sync flush c-$mode >/dev/null
  r=$("$RE/sshwrap/ssh" remote "cat /work/c-$mode/a.txt; ls /work/c-$mode" | tr '\n' ' ')
  c=$(mutagen sync list c-$mode --template '{{ json . }}' | python3 -I -c "import json,sys;d=json.load(sys.stdin)[0];print(len(d.get('conflicts') or []), 'conflict(s)')")
  echo "$mode: local a.txt=$(cat $L/a.txt); local files=$(ls $L | tr '\n' ' '); remote a.txt+files=$r; $c"
  mutagen sync terminate c-$mode >/dev/null
done
