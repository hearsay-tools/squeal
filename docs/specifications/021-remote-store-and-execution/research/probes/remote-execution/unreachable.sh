#!/usr/bin/env bash
# Throwaway (row 021-02): what Mutagen reports when the remote stops answering (docker pause),
# and whether `mutagen sync flush` blocks or fails. Restores the container at the end.
set -uo pipefail
. "$(dirname "$0")/env.sh"
F=$RE/local/squeal/src/unreachable-probe.txt
st(){ mutagen sync list sq --template '{{ json . }}' | python3 -I -c "import json,sys;d=json.load(sys.stdin)[0];print('status',d['status'],'| beta connected',d['beta'].get('connected'),'| lastError',(d.get('lastError') or '')[:160])"; }
docker pause squeal-021-remote >/dev/null; echo "paused at $(date -u +%T)"
echo one > $F
s=$(date +%s.%N); timeout 45 mutagen sync flush sq >/dev/null 2>$RE/flush-unreach.err; rc=$?
echo "flush exit $rc after $(echo "$(date +%s.%N) - $s" | bc) s: $(tr '\r' '\n' < $RE/flush-unreach.err | grep -v '^\s*$' | tail -1 | cut -c1-160)"
st
docker unpause squeal-021-remote >/dev/null; echo "unpaused at $(date -u +%T)"
s=$(date +%s.%N); timeout 120 mutagen sync flush sq >/dev/null 2>&1; rc=$?
echo "flush after unpause exit $rc after $(echo "$(date +%s.%N) - $s" | bc) s"; st
echo "remote file: $("$RE/sshwrap/ssh" remote cat /work/squeal/src/unreachable-probe.txt 2>&1)"
rm -f $F; mutagen sync flush sq >/dev/null 2>&1
