#!/usr/bin/env bash
# Throwaway (018-21). Read-only GitHub calls: cezarion CI runs (merge_group and
# push to main) since $SINCE, their jobs, and the logs of the Vitest shard and
# Squeal export/publish jobs whose work step ran. Writes under $1 (default
# $TMPDIR/sp/data); skips files already fetched, so a re-run only adds new runs.
# Usage: SINCE=2026-11-08T00:00:00Z bash fetch-ci.sh [out dir]
set -euo pipefail
OUT=${1:-$TMPDIR/sp/data}
SINCE=${SINCE:-2026-11-08T00:00:00Z}
REPO=hearsay-tools/cezarion
mkdir -p "$OUT/jobs" "$OUT/logs"
: > "$OUT/runs.jsonl"
for ev in merge_group push; do
  page=1
  while :; do
    body=$(gh api "repos/$REPO/actions/workflows/ci.yml/runs?event=$ev&per_page=100&page=$page&created=>=$SINCE")
    n=$(jq '.workflow_runs | length' <<<"$body")
    jq -c '.workflow_runs[] | {id, event, head_sha, head_branch, created_at, run_started_at, updated_at, status, conclusion, run_attempt}' <<<"$body" >> "$OUT/runs.jsonl"
    [ "$n" -lt 100 ] && break
    page=$((page + 1))
  done
done
jq -r 'select(.status=="completed") | .id' "$OUT/runs.jsonl" | while read -r id; do
  f="$OUT/jobs/$id.json"
  [ -s "$f" ] || gh api "repos/$REPO/actions/runs/$id/jobs?filter=all&per_page=100" > "$f"
  # Logs: shard jobs whose test step succeeded, and the export/publish jobs.
  jq -r '.jobs[] | select(
      (.name|test("^Vitest shard")) and ([.steps[]? | select((.name|test("^Run server and cockpit unit suites")) and .conclusion=="success")] | length > 0)
      or (.name|test("Squeal shared results")) and .conclusion != "skipped")
    | .id' "$f" | while read -r job; do
    l="$OUT/logs/$job.txt"
    [ -s "$l" ] || gh run view "$id" -R "$REPO" --log --job "$job" 2>/dev/null \
      | sed 's/\x1b\[[0-9;]*m//g; s/\^\[\[[0-9;]*m//g' > "$l" || true
  done
done
echo "runs: $(wc -l < "$OUT/runs.jsonl"), jobs files: $(ls "$OUT/jobs" | wc -l), logs: $(ls "$OUT/logs" | wc -l)"
