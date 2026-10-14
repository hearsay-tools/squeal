# Throwaway. Sourced by every probe script; runs as squeal-e2e only.
# XDG dirs are this probe's own, so the sibling probe's OpenCode database and
# plugin cache are not shared. Isolation from the real HOME is the OS user.
export W=/home/squeal-e2e/008-sessions
export XDG_CONFIG_HOME=$W/xdg/config XDG_DATA_HOME=$W/xdg/data XDG_CACHE_HOME=$W/xdg/cache XDG_STATE_HOME=$W/xdg/state
export PATH=/home/squeal-e2e/.npm-global/bin:/opt/squeal-e2e/node24/bin:/usr/bin:/bin
export MODEL=cliproxy/gpt-6-luna
export PROBE_LOG=$W/log/events.jsonl
mkdir -p $W/log $XDG_CONFIG_HOME $XDG_DATA_HOME $XDG_CACHE_HOME $XDG_STATE_HOME
