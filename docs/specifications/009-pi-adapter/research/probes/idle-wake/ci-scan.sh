#!/bin/bash
# Throwaway probe (see README.md); reads only.
# For each candidate run attempt: failed jobs and their failure annotations, one line each.
while read id att; do
  for a in $(seq 1 "$att"); do
    timeout 60 gh api "repos/hearsay-tools/squeal/actions/runs/$id/attempts/$a/jobs" \
      --jq '.jobs[] | select(.conclusion=="failure") | "\(.id)\t\(.name)"' 2>/dev/null |
    while IFS=$'\t' read -r jid jname; do
      msg=$(timeout 60 gh api "repos/hearsay-tools/squeal/check-runs/$jid/annotations" \
        --jq '[.[] | select(.annotation_level=="failure") | (.path + ": " + (.message|split("\n")[0]))] | join(" | ")' 2>/dev/null)
      printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$a" "$jid" "$jname" "$msg"
    done
  done
done
