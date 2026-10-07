#!/bin/sh
# Throwaway: a silent hook in the scratch CODEX_HOME's user layer that appends
# {t, event, stdin} to $P/logs/stdin.jsonl, to see what Squeal's hooks receive.
printf '{"t":%s,"stdin":%s}\n' "$(date +%s%3N)" "$(cat)" >> /tmp/p16/logs/stdin.jsonl
