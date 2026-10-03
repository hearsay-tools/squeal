#!/bin/bash
# Throwaway: simulates a hook stuck on a dead daemon (never answers).
"$(dirname "$0")/log.sh" hang >/dev/null
sleep 30
