#!/usr/bin/env bash
# THROWAWAY helper for row 010-13. Run inside a scratch worktree of hearsay-tools/squeal.
#   probe.sh push <sha> <branch>   push a SHA to refs/heads/probe/010-13-<branch>, log output and exit code
#   probe.sh checks <sha>          list the check runs GitHub holds for a SHA
#   probe.sh runs                  list the probe workflow's runs with created/started/finished times
set -u
LOG=${LOG:-transcript.txt}
case "$1" in
  push)
    { echo "=== $(date -u +%FT%TZ) git push origin $2:refs/heads/probe/010-13-$3 ${4:-}"
      git push ${4:-} origin "$2:refs/heads/probe/010-13-$3" 2>&1; echo "exit=$?"; } | tee -a "$LOG" ;;
  checks)
    { echo "=== $(date -u +%FT%TZ) check runs of $2"
      gh api "repos/hearsay-tools/squeal/commits/$2/check-runs" \
        --jq '.check_runs[] | "\(.name) status=\(.status) conclusion=\(.conclusion) app=\(.app.slug) started=\(.started_at) completed=\(.completed_at)"'; } | tee -a "$LOG" ;;
  runs)
    gh api "repos/hearsay-tools/squeal/actions/workflows/probe-010-13.yml/runs?per_page=50" \
      --jq '.workflow_runs[] | "\(.id) \(.event) \(.head_branch) \(.head_sha[0:8]) \(.status)/\(.conclusion) created=\(.created_at) started=\(.run_started_at) updated=\(.updated_at)"' ;;
esac
# probe.sh wait <sha>: poll every 5 s until the SHA's check run completes (10 min cap)
if [ "$1" = wait ]; then
  for i in $(seq 1 120); do
    s=$(gh api "repos/hearsay-tools/squeal/commits/$2/check-runs" --jq '[.check_runs[]|.status]|join(",")')
    [[ "$s" == *completed* ]] && { echo "=== $(date -u +%FT%TZ) $2 check completed" | tee -a "$LOG"; break; }
    sleep 5
  done
fi
