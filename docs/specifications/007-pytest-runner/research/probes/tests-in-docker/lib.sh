# Throwaway probe helpers for research/tests-in-docker.md.
PROBE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OUT="$PROBE/out"
SCRATCH="$PROBE/scratch"
mkdir -p "$OUT" "$SCRATCH"
# Every docker command runs under the docker group, which this process lacks.
d() { sg docker -c "$*"; }
load() { cut -d' ' -f1 /proc/loadavg; }
# Milliseconds for one command.
ms() { local s e; s=$(date +%s%N); "$@" >/dev/null 2>&1; local rc=$?; e=$(date +%s%N); echo "$(( (e - s) / 1000000 )) rc=$rc"; }
