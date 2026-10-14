#!/bin/sh
# Throwaway probe for 007-18: the two model sessions, as squeal-e2e, in the case root.
#   sh sessions.sh <out dir> <claude|codex>...
#     claude  Claude Code, model claude-sonnet-5-5, in wt-claude
#     codex   Codex, model gpt-6.1-sol, in wt-codex
# Both get prompts/task.txt: fix the seeded failing test, then refactor briefcase/cmdline.py (a
# module two test files reach). Effort medium. Claude Code: stream-json with hook events,
# bypassPermissions (an isolated user, as 005-17 and 005-18 ran), the plugin at user scope in the
# case's CLAUDE_CONFIG_DIR. Codex: exec --json, danger-full-access, the plugin and its trusted
# hooks in the case's CODEX_HOME. Output lines are timestamped as they arrive (epoch seconds).
# Credentials pass by name only (E2E_PRESERVE), never in argv. Start, end, load and exit go to
# <id>.meta.
set -u
here=$(cd "$(dirname "$0")" && pwd)
out=$1
shift
mkdir -p "$out"
R=/home/squeal-e2e/runs/sq07-18
TASK=$(cat "$here/prompts/task.txt")
as() { dir=$1; shift; node "$here/as-e2e.mjs" "$R" "$R/$dir" "$@"; }
stamp() { python3 -I -u -c '
import sys, time
for line in sys.stdin:
    print(f"{time.time():.3f} {line}", end="", flush=True)
'; }
claude_s() {
  E2E_PRESERVE=ANTHROPIC_BASE_URL,ANTHROPIC_AUTH_TOKEN as wt-claude claude -p "$TASK" \
    --model claude-sonnet-5-5 --effort medium --output-format stream-json --verbose \
    --include-hook-events --permission-mode bypassPermissions
}
codex_s() {
  E2E_PRESERVE=CLIPROXY_API_KEY as wt-codex codex exec --json -s danger-full-access \
    -m gpt-6.1-sol -c 'model_reasoning_effort="medium"' "$TASK"
}
for id in "$@"; do
  load=$(cut -d' ' -f1 /proc/loadavg)
  start=$(date -u +%FT%TZ)
  t0=$(date +%s)
  "${id}_s" < /dev/null 2> "$out/$id.stderr" | stamp > "$out/$id.jsonl"
  code=$?
  printf '{"id":"%s","start":"%s","loadAtStart":%s,"wallS":%s,"exit":%s,"loadAtEnd":%s}\n' \
    "$id" "$start" "$load" "$(($(date +%s) - t0))" "$code" "$(cut -d' ' -f1 /proc/loadavg)" > "$out/$id.meta"
  cat "$out/$id.meta"
done
