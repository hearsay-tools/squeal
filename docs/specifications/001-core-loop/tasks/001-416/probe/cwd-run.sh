set -eu
cd /home/squeal-e2e/probe-416/repo
timeout 300 claude -p --model haiku --permission-mode bypassPermissions \
  "Use the Agent tool with subagent_type \"iso\" to run this exact command: pwd && git rev-parse --show-toplevel. Then reply with the subagent's output verbatim and nothing else." \
  > /home/squeal-e2e/probe-416/claude.out 2> /home/squeal-e2e/probe-416/claude.err || echo "exit $?"
cat /home/squeal-e2e/probe-416/claude.out; echo ---; tail -5 /home/squeal-e2e/probe-416/claude.err
