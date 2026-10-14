#!/bin/sh
# Throwaway probe for 005-18 part 2: the four model sessions on cezar, as squeal-e2e, in
# /home/squeal-e2e/runs/sq18-cz (see part2.sh for the copies).
#   sh part2-sessions.sh <out dir> <id>...
#     skill-claude  `/squeal:setup` in skill/, Claude Code claude-sonnet-5-5
#     skill-codex   `$squeal:setup` in skill/ after a reset to 3a5d161, Codex gpt-6-luna
#     edit-claude   the retry-backoff edit in fresh/ (set up by arm b), Claude Code sonnet
#     edit-codex    the same edit in fresh/ after reverting the first, Codex gpt-6-luna
# Effort medium. Claude Code: stream-json with hook events, bypassPermissions (an isolated
# user; 005-17's sessions ran so), the plugin installed at user scope in the case HOME. Codex:
# exec --json, danger-full-access, the provider config in the case's CODEX_HOME. Each session
# starts only while the one-minute load is below 24; its load, start, end and exit go to
# <id>.meta. Output lines are timestamped as they arrive. Credentials pass by name only.
set -u
here=$(cd "$(dirname "$0")" && pwd)
out=$1
shift
mkdir -p "$out"
R=/home/squeal-e2e/runs/sq18-cz
as() { dir=$1; shift; node "$here/as-e2e.mjs" "$R" "$R/$dir" "$@"; }
stamp() { python3 -I -u -c '
import sys, time
for line in sys.stdin:
    print(f"{time.time():.3f} {line}", end="", flush=True)
'; }
ENDING='When you are finished, end your reply with one line in exactly this form, choosing one of the three words:
TESTS: pass | fail | unknown, evidence: <what you base it on>'
SETUP='Set up Squeal in this repository. I will not answer questions in this session: wherever you would ask me, take the default and tell me what you chose.'
EDIT="The orphan reprobe's fast window is too long. In packages/cezar/src/delegation/retry-backoff.ts, keep its 15 s cadence for the first 10 minutes instead of the first 15, and update whatever depends on that. Then tell me whether the tests pass.

$ENDING"

claude_s() { # <dir> <prompt>
  E2E_PRESERVE=ANTHROPIC_BASE_URL,ANTHROPIC_AUTH_TOKEN as "$1" claude -p "$2" \
    --model claude-sonnet-5-5 --effort medium --output-format stream-json --verbose \
    --include-hook-events --permission-mode bypassPermissions
}
codex_s() { # <dir> <prompt>
  E2E_PRESERVE=CLIPROXY_API_KEY as "$1" codex exec --json -s danger-full-access \
    -m gpt-6-luna -c 'model_reasoning_effort="medium"' "$2"
}
session() { # <id> <fn> <dir> <prompt>
  id=$1
  while [ "$(cut -d' ' -f1 /proc/loadavg | cut -d. -f1)" -ge 24 ]; do sleep 30; done
  load=$(cut -d' ' -f1 /proc/loadavg)
  start=$(date -u +%FT%TZ)
  t0=$(date +%s)
  "$2" "$3" "$4" < /dev/null 2> "$out/$id.stderr" | stamp > "$out/$id.jsonl"
  code=$?
  printf '{"id":"%s","start":"%s","loadAtStart":%s,"wallS":%s,"exit":%s}\n' \
    "$id" "$start" "$load" "$(($(date +%s) - t0))" "$code" > "$out/$id.meta"
  cat "$out/$id.meta"
}

for id in "$@"; do
  case "$id" in
    skill-claude) session "$id" claude_s skill "/squeal:setup

$SETUP" ;;
    skill-codex)
      as skill /bin/sh -c 'squeal stop . >/dev/null 2>&1; git reset -q --hard 3a5d161 && git clean -qfdx -e node_modules -e "**/node_modules" && rm -rf .git/squeal'
      session "$id" codex_s skill "\$squeal:setup

$SETUP" ;;
    edit-claude) session "$id" claude_s fresh "$EDIT" ;;
    edit-codex)
      as fresh /bin/sh -c 'git checkout -q -- packages .ai/specs && git clean -qfd packages'
      session "$id" codex_s fresh "$EDIT" ;;
  esac
done
