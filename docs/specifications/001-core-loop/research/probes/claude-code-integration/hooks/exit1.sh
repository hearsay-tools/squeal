#!/bin/bash
# Throwaway: simulates "daemon not running" reported with exit 1.
"$(dirname "$0")/log.sh" exit1 >/dev/null
echo "squeal: daemon socket refused connection" >&2
exit 1
