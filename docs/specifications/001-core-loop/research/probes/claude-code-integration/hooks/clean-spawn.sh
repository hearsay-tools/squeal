#!/bin/bash
# Throwaway: spawns a fully detached child (setsid, stdio closed). Hook returns immediately.
"$(dirname "$0")/log.sh" clean >/dev/null
setsid nohup sleep 8 </dev/null >/dev/null 2>&1 &
exit 0
