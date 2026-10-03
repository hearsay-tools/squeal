#!/bin/bash
# Throwaway: append hook stdin + timestamp (ms) to logs/<scenario>.hooks.log
IN=$(cat)
echo "{\"t_ms\":$(date +%s%3N),\"pid\":$$,\"argv\":\"$*\",\"in\":$IN}" >> "$PROBE_LOG_DIR/$PROBE_SCN.hooks.log"
printf '%s' "$IN"
