#!/bin/bash
# Throwaway: spawns a background child that inherits stdout (common mistake when starting a daemon).
"$(dirname "$0")/log.sh" leaky >/dev/null
sleep 8 &
exit 0
