set -eu
C=/home/squeal-e2e/runs/sw19/$1
for v in $(env | sed 's/=.*//'); do case $v in ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN) ;; *) unset "$v" 2>/dev/null || true;; esac; done
export HOME=/home/squeal-e2e
export PATH=/opt/squeal-e2e/node22/bin:/home/squeal-e2e/.npm-global/bin:/usr/bin:/bin
cd "$C/repo"
date +%s > "$C/run.start"
claude --version > "$C/version" 2>&1 || true
timeout 3000 claude -p --model haiku --output-format json "Reply with the single word OK." \
  > "$C/claude.out" 2> "$C/claude.err" || echo "exit $?" >> "$C/claude.err"
date +%s > "$C/run.end"
cat "$C/version"; echo; cat "$C/run.start" "$C/run.end"; cat "$C/claude.out"; echo; echo ---; tail -5 "$C/claude.err"; echo ---; cut -c1-300 "$C/hook.log"
