#!/bin/sh
# Throwaway. Prints the environment's variable names (never values) and whether the key is set.
echo "user=$(id -un) cwd=$(pwd)"
env | cut -d= -f1 | sort | tr '\n' ' '; echo
[ -n "${CLIPROXY_API_KEY:-}" ] && echo "CLIPROXY_API_KEY present" || echo "CLIPROXY_API_KEY missing"
