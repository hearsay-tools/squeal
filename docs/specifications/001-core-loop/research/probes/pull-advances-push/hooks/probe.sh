#!/bin/bash
# Throwaway: what a Bash tool subprocess sees of its session and agent.
LABEL="${1:-unlabelled}"
{
  echo "=== probe $LABEL t_ms=$(date +%s%3N) pid=$$ ppid=$PPID cwd=$PWD"
  echo "--- env (CLAUDE*, names of everything else)"
  env | grep -E "^(CLAUDE|CLAUDECODE|SQUEAL)" | grep -v -E 'TOKEN' | sort
  echo "other names: $(env | cut -d= -f1 | grep -v -E '^(CLAUDE|CLAUDECODE)' | sort | paste -sd' ' -)"
  echo "--- process chain"
  p=$$; for i in 1 2 3 4 5 6; do
    [ -r /proc/$p/stat ] || break
    pp=$(awk '{print $4}' /proc/$p/stat)
    echo "$p <- $pp : $(tr '\0' ' ' < /proc/$p/cmdline | cut -c1-220)"
    p=$pp; [ "$p" = 1 ] && break
  done
  echo "--- fds of this shell"
  for f in /proc/$$/fd/*; do echo "$(basename $f) -> $(readlink $f)"; done
  echo "--- fds of parent ($PPID)"
  for f in /proc/$PPID/fd/*; do echo "$(basename $f) -> $(readlink $f)"; done 2>/dev/null | head -20
} >> "$PROBE_OUT"
echo "probe $LABEL recorded"
