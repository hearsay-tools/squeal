#!/usr/bin/env bash
# Throwaway Q2a: codex exec started in /tmp with -C <repo>/pkg/sub; plugin hooks trusted only by
# a -c hooks.state override (session flags), no bypass flag. Hook log: /tmp/w0c/logs/q2-exec.jsonl
set -e
B="$(cd "$(dirname "$0")" && pwd)"
STATE=$(bash "$B/q2-setup.sh"); export CODEX_HOME=/tmp/w0c/home-q2
rm -f /tmp/w0c/logs/q2-exec.jsonl; cd /tmp
W0C_LOG=/tmp/w0c/logs/q2-exec.jsonl codex exec -c "$STATE" -C /tmp/w0c/r-q2/pkg/sub --skip-git-repo-check --json \
  'Run `pwd` with your shell tool. Then spawn exactly one subagent whose only job is to run `pwd` with its shell tool and report the output; wait for it. Reply with both outputs, nothing else.' \
  < /dev/null > /tmp/w0c/logs/q2-exec.events.jsonl 2>/tmp/w0c/logs/q2-exec.stderr
tail -1 /tmp/w0c/logs/q2-exec.events.jsonl | cut -c1-300
