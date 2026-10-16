#!/usr/bin/env bash
# Throwaway probe for hearsay-tools/squeal#19. Usage: extract.sh <repo-root>
set -u
R=${1:?repo root}
for H in claude codex; do
  B=$HOME/.$H/plugins/cache/hearsay/squeal/0.1.199
  echo "== 0.1.199 $H primer (dist/session-start.mjs)"
  grep -o '`Slow test files run when[^`]*`[^`]*`[^`]*`[^`]*' "$B/dist/session-start.mjs" | sort -u
  echo "== 0.1.199 $H skill step 4"
  grep '^4\.' "$B/skills/squeal/SKILL.md"
done
echo "== 0.1.203 source src/harness/shared/primer.ts slowSentences"
sed -n '/^function slowSentences/,/^}/p' "$R/src/harness/shared/primer.ts" | grep -o 'Slow test files run when.*'
echo "== 0.1.203 committed bundle plugins/claude-code/dist/session-start.mjs"
grep -o 'this repository \(does not require\|requires\) them before you finish' "$R/plugins/claude-code/dist/session-start.mjs" | sort | uniq -c
echo "== 0.1.203 skill step 4"
grep '^4\.' "$R/plugins/claude-code/skills/squeal/SKILL.md"
echo "== read-only / no-edit exemption words in 0.1.203 primer source and skill"
grep -n -i 'read-only\|no edit\|did not edit\|review' "$R/src/harness/shared/primer.ts" "$R/plugins/claude-code/skills/squeal/SKILL.md" || echo "(none)"
echo "== cezarion squeal.config.json stop at cf82973"
git -C "$HOME/projects/cezar" show cf82973252a2ff702b4f5d18df7bd238cbcb9131:squeal.config.json | grep -A5 '"stop"'
