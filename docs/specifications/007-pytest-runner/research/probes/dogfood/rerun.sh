#!/bin/sh
# Throwaway probe for 007-18: what one edit to a module two closures hold costs in runs.
#   sh rerun.sh <out file> <dir> <path> [<path>...]
# In <dir> (a case clone with a running daemon and a current baseline): append a comment line to
# each path, then every 2 s log the runs started since, their files, distinct files, and the
# sizes of the pytest observed meta keys, until nothing is running or queued for 10 s or 300 s
# pass. The comment stays. REVERT=1 instead checks the paths out (git checkout); TAG=<text> varies
# the comment.
set -u
here=$(cd "$(dirname "$0")" && pwd)
R=/home/squeal-e2e/runs/sq07-18
out=$1
dir=$2
shift 2
as() { node "$here/as-e2e.mjs" "$R" "$R/$dir" "$@"; }
snap() {
  sudo -n -u squeal-e2e "$R/repo/.venv/bin/python" -I -c '
import json, sqlite3, sys
R, wt, t0 = sys.argv[1], sys.argv[2], int(sys.argv[3])
db = sqlite3.connect(f"file:{R}/repo/.git/squeal/store.sqlite?mode=ro", uri=True)
w = db.execute("select id from worktrees where root=?", (wt,)).fetchone()[0]
runs = db.execute("select test_files, ended_at from runs where worktree_id=? and started_at>=?", (w, t0)).fetchall()
files = [f["path"] for r in runs for f in json.loads(r[0])]
meta = {k: len(json.loads(v)) for k, v in db.execute("select key, value from meta where key like ?", ("pytest.observed%",))}
print(f"runs {len(runs)} open {sum(1 for r in runs if r[1] is None)} file-runs {len(files)} distinct {len(set(files))} meta {meta}")
' "$R" "$R/$dir" "$1"
}
{
  echo "== $dir edit $* at $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)"
  t0=$(($(date +%s) * 1000))
  if [ "${REVERT:-}" = 1 ]; then
    as git checkout -q -- "$@"
  else
    for p in "$@"; do as sh -c 'printf "\n# squeal 007-18 probe %s\n" "$2" >> "$1"' sh "$p" "${TAG:-1}"; done
  fi
  quiet=0
  i=0
  while [ $i -lt 150 ]; do
    sleep 2
    i=$((i + 1))
    line=$(as squeal status 2>&1 | sed -n 3p)
    echo "$(date -u +%T) load $(cut -d' ' -f1 /proc/loadavg) $(snap "$t0") | $line"
    if echo "$line" | grep -q "0 running, 0 queued"; then quiet=$((quiet + 1)); else quiet=0; fi
    [ $quiet -ge 5 ] && break
  done
  echo "== end $(date -u +%FT%TZ)"
} > "$out" 2>&1
tail -4 "$out" | cut -c1-400
