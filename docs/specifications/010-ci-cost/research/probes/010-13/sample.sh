#!/usr/bin/env bash
# THROWAWAY sampler for row 010-13, question 3: push a one-file change to probe/010-13-src every
# INTERVAL seconds, COUNT times, and log push -> run created -> job started -> job completed, with
# the queued and running Actions runs in squeal and cezarion at push time as the pool's load.
set -u
OUT=${OUT:-samples.tsv}; COUNT=${COUNT:-6}; INTERVAL=${INTERVAL:-600}
load() { for r in squeal cezarion; do for s in queued in_progress; do
  printf '%s ' "$(gh api "repos/hearsay-tools/$r/actions/runs?status=$s&per_page=1" --jq .total_count)"; done; done; }
for n in $(seq 1 "$COUNT"); do
  mkdir -p probe-touch; date > probe-touch/sample; git add probe-touch
  git commit -qm "probe 010-13: timing sample $n"; sha=$(git rev-parse HEAD)
  l=$(load); t0=$(date -u +%FT%TZ)
  git push -q origin "$sha:refs/heads/probe/010-13-src" 2>/dev/null
  for i in $(seq 1 180); do
    st=$(gh api "repos/hearsay-tools/squeal/commits/$sha/check-runs" --jq '.check_runs[0].status // ""')
    [ "$st" = completed ] && break; sleep 5
  done
  run=$(gh api "repos/hearsay-tools/squeal/actions/runs?head_sha=$sha" --jq '.workflow_runs[0].created_at')
  job=$(gh api "repos/hearsay-tools/squeal/commits/$sha/check-runs" --jq '.check_runs[0]|"\(.started_at)\t\(.completed_at)\t\(.conclusion)"')
  # columns: n, sha, pushed, run created, job started, job completed, conclusion, load (squeal queued, running, cezarion queued, running)
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$n" "${sha:0:8}" "$t0" "$run" "$job" "$l" | tee -a "$OUT"
  [ "$n" -lt "$COUNT" ] && sleep "$INTERVAL"
done
echo SAMPLER-DONE
