#!/usr/bin/env bash
# Throwaway probe (row 018-69). Runs inside a boat.dev sandbox, never on the host.
# A coordinator-like worktree of hearsay-tools/squawk with a running daemon
# fast-forwards from one main commit to the next. The remote is a local bare
# copy (origin.git, shallow, with refs/squeal/<sha> fetched read-only from
# GitHub), so the reader's ls-remote and fetch run as they do against GitHub.
# Usage: ff.sh setup | ff.sh run <name> <from> <to> <late-seconds|0>
#   late 0: refs/squeal/<to> is on the remote before the merge lands.
#   late N: it is published N seconds after the fast-forward (CI's publish lag).
set -u
B=${P261:-/home/user/p261}
export HOME=$B/home XDG_RUNTIME_DIR=$B/run
export PATH=$B/node/bin:$B/pnpm/bin:$PATH
SQ=(node --disable-warning=ExperimentalWarning "$B/plugin/dist/cli/squeal.mjs")
O=$B/origin.git

setup() {
  mkdir -p "$B/home" "$B/run" "$B/out" && chmod 700 "$B/run"
  cd "$B" || exit 1
  [ -d node ] || { curl -fsSL https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-x64.tar.xz | tar xJ && mv node-v26.13.0-linux-x64 node; }
  [ -x pnpm/bin/pnpm ] || npm i -g --prefix "$B/pnpm" pnpm@12.11.2 > out/pnpm-install.txt 2>&1
  [ -d origin.git ] || tar xzf payload.tgz
  git config --global user.email probe@example.invalid
  git config --global user.name probe
  git config --global init.defaultBranch main
  # keep every results ref's object id, so a scenario can hide and publish one
  git -C "$O" for-each-ref refs/squeal --format='%(refname) %(objectname)' > "$B/squeal-refs.txt"
  node --version; pnpm --version; "${SQ[@]}" --version
}

log() { echo "$(date -u +%FT%T.%3NZ) load=$(cut -d' ' -f1 /proc/loadavg) $*" | tee -a "$OUT/log.txt"; }

# one line per status: time, revision, head, file counts, phases, imported/inherited counts
snap() {
  "${SQ[@]}" status --json 2> /dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const j = JSON.parse(s);
        console.log(JSON.stringify({ at: new Date().toISOString(), tag: process.argv[1], revision: j.revision,
          head: (j.head ?? "").slice(0, 8), files: j.testFileCounts, phase: j.testFilesByPhase,
          inheritedFiles: j.inheritedFileLevelCount, runsOpen: j.runsOpen,
          notes: (j.notes ?? []).map((n) => n.text ?? n).filter((t) => /CI results/.test(t)) }));
      } catch { console.log(JSON.stringify({ at: new Date().toISOString(), tag: process.argv[1], error: s.slice(0, 200) })); }
    });' "$1" >> "$OUT/status.jsonl"
}

# snapshots every $2 s for $3 s; stops early once nothing is queued or running and $4 s passed
watch_for() {
  local tag=$1 every=$2 total=$3 min=${4:-0} start=$SECONDS
  while [ $((SECONDS - start)) -lt "$total" ]; do
    snap "$tag"
    # idle: nothing running, and only the manual browser group (97 files in squawk) left queued
    if [ $((SECONDS - start)) -ge "$min" ] && tail -1 "$OUT/status.jsonl" | node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); process.exit(j.phase && j.phase.running === 0 && j.phase.queued <= Number(process.env.MANUAL_QUEUED ?? 97) ? 0 : 1)'; then return; fi
    sleep "$every"
  done
}

# until the daemon log names an import of $1's export, or $2 s
wait_import() {
  local start=$SECONDS
  until grep -qs "CI results: imported .* at ${1:0:8}" .git/squeal/logs/daemon-*.log; do
    [ $((SECONDS - start)) -ge "$2" ] && { log "no import of ${1:0:8} after $2 s"; return; }
    sleep 2
  done
  log "imported ${1:0:8}: $(grep -h "CI results" .git/squeal/logs/daemon-*.log | tail -1)"
}

# snapshots every second until the status revision passes $1, or $2 s
wait_revision() {
  local start=$SECONDS
  while [ $((SECONDS - start)) -lt "$2" ]; do
    snap ff-wait
    tail -1 "$OUT/status.jsonl" | node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); process.exit(j.revision > Number(process.argv[1]) ? 0 : 1)' "$1" && { log "revision passed $1"; return; }
    sleep 1
  done
  log "revision still $1 after $2 s"
}

run() {
  local name=$1 from=$2 to=$3 late=$4
  OUT=$B/out/$name; rm -rf "$OUT"; mkdir -p "$OUT"
  local W=$B/work-$name ref oid
  ref=refs/squeal/$to
  oid=$(awk -v r="$ref" '$1 == r { print $2 }' "$B/squeal-refs.txt")
  git -C "$O" update-ref refs/heads/main "$from"
  # every results ref on the remote; with late > 0, the one of $to is held back
  while read -r r o; do git -C "$O" update-ref "$r" "$o"; done < "$B/squeal-refs.txt"
  if [ "$late" != 0 ]; then git -C "$O" update-ref -d "$ref"; fi
  rm -rf "$W"; git clone -q "file://$O" "$W" && cd "$W" || exit 1
  git checkout -q -B coord origin/main
  log "install"; pnpm install --frozen-lockfile > "$OUT/install.txt" 2>&1; log "install exit $?"
  log "squeal start at $(git rev-parse --short HEAD)"
  "${SQ[@]}" start > "$OUT/start.txt" 2>&1; log "start exit $?"
  wait_import "$from" 300
  watch_for start 5 300 30
  "${SQ[@]}" status --full > "$OUT/before-full.txt" 2>&1
  # the merge lands on main, then the coordinator's fast-forward
  git -C "$O" update-ref refs/heads/main "$to"
  local rev0
  rev0=$(tail -1 "$OUT/status.jsonl" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).revision')
  git fetch -q origin
  log "ff to $(git rev-parse --short origin/main) (revision $rev0)"
  git merge -q --ff-only origin/main; log "ff done"
  wait_revision "$rev0" 120
  if [ "$late" != 0 ]; then
    (sleep "$late"; git -C "$O" update-ref "$ref" "$oid"; log "published $ref"
      # an edit after the publish: a batch, so the reader is nudged again at the same start point
      sleep 120; echo >> README.md; log "edit README.md"; sleep 20; git checkout -q README.md; log "restore README.md") &
  fi
  watch_for ff 2 120 60
  if [ "$late" != 0 ]; then
    watch_for ff-late 15 1200 900
    "${SQ[@]}" status --full > "$OUT/before-restart-full.txt" 2>&1
    log "restart"; "${SQ[@]}" stop > "$OUT/stop1.txt" 2>&1; "${SQ[@]}" start > "$OUT/start2.txt" 2>&1
    wait_import "$to" 300
    watch_for restart 2 120 30
  fi
  watch_for settle 15 2400 0
  "${SQ[@]}" status --full > "$OUT/after-full.txt" 2>&1
  "${SQ[@]}" status --json > "$OUT/after.json" 2>&1
  log "stop"; "${SQ[@]}" stop > "$OUT/stop.txt" 2>&1; log "stop exit $?"
  cp .git/squeal/store.sqlite* "$OUT/" 2> /dev/null
  cp -r .git/squeal/logs "$OUT/logs" 2> /dev/null
  log "done"
}

stop_all() {
  for w in "$B"/work-*; do (cd "$w" && "${SQ[@]}" stop > /dev/null 2>&1); done
}

case ${1:-} in
  setup) setup ;;
  stop) stop_all ;;
  run) shift; run "$@" ;;
  *) echo "usage: ff.sh setup | ff.sh run <name> <from> <to> <late-seconds|0>" >&2; exit 2 ;;
esac
