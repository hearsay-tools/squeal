#!/bin/sh
# Throwaway probe (016-35). Run as squeal-e2e with HOME=/home/squeal-e2e.
# Usage: reset-repo.sh [start|baseline]
# Puts the tracked files back to the committed (passing) text and deletes the
# file the stray OMP session of omp2 wrote under .git/squeal and the files
# the sessions write (deny-me.txt, notes*.txt).
#   start:    starts Squeal's daemon with real Node (not the Node OMP would
#             name), gives every test file a result, and leaves it running, so
#             a session finds a live daemon and spawns none.
#   baseline: the same, then `squeal stop`, so the session must spawn one.
set -u
cd "$HOME/ht035/repo"
git checkout -q -- .
rm -f .git/squeal/sum.js deny-me.txt notes*.txt
S="node --disable-warning=ExperimentalWarning $HOME/ht035/squeal/plugins/pi/dist/cli/squeal.mjs"
case "${1:-}" in
  start | baseline)
    $S start </dev/null
    for f in *.test.js; do $S retry "$f" </dev/null >/dev/null; done
    $S status --wait 60000 *.test.js </dev/null | tail -1
    ;;
esac
[ "${1:-}" = baseline ] && $S stop </dev/null
exit 0
