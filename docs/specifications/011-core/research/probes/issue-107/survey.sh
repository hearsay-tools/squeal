#!/bin/sh
# Throwaway probe for research/issue-107.md, experiment E2: a read-only survey of the host's
# cezarion fixture servers. Reads /proc only: cwd, stat, cmdline, and env variable NAMES.
# Never reads an env value, never signals, never opens a store or socket.
# For each server it names its watcher (test-env-lease.mjs watch-app <pid>), whose cwd is the
# os.tmpdir() of the process that booted the app; it compares that with the Squeal daemon
# scratch of the server's root (/tmp/squeal-<uid>/tmp/<sha256(repository-id \0 root)[:16]>,
# src/core/daemon/scratch.ts). A match means a Squeal daemon process booted it.
# Usage: sh survey.sh
BT=$(awk '/^btime/{print $2}' /proc/stat); HZ=$(getconf CLK_TCK); NOW=$(date +%s)
echo "survey at $(date -u +%FT%TZ), load $(cut -d' ' -f1-3 /proc/loadavg), $(nproc) CPUs"
for p in $(ls /proc | grep -E '^[0-9]+$'); do
  cmd=$( { tr "\0" " " < /proc/$p/cmdline; } 2>/dev/null) || continue
  case "$cmd" in *".ai/qa/build/cezar/dist/index.js"*"--repo"*) ;; *) continue ;; esac
  root=$(readlink /proc/$p/cwd 2>/dev/null)
  set -- $(sed 's/.*) //' /proc/$p/stat | cut -d' ' -f2,3,20)
  age=$((NOW - BT - $3 / HZ))
  names=$(tr '\0' '\n' < /proc/$p/environ 2>/dev/null | cut -d= -f1 | grep -E '^(SQUEAL_|VITEST|TEST_ENV_|CODEX_SESSION_ID|CLAUDE_PLUGIN_ROOT)' | sort | tr '\n' ' ')
  watcher=""; wcwd=""
  for w in $(pgrep -f "test-env-lease.mjs watch-app $p "); do watcher=$w; wcwd=$(readlink /proc/$w/cwd); done
  common=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  key=""; [ -f "$common/squeal/repository-id" ] && key=$(printf '%s\0%s' "$(cat "$common/squeal/repository-id")" "$root" | sha256sum | cut -c1-16)
  daemon=$(pgrep -f "squeal.mjs daemon $root( |\$)" | head -1)
  echo "server pid=$p ppid=$1 pgid=$2 age=${age}s root=$root"
  echo "  env names: [$names]"
  echo "  watcher=${watcher:-none} watcherCwd=${wcwd:-?}"
  echo "  squeal scratch for root: /tmp/squeal-$(id -u)/tmp/$key  match=$(case "$wcwd" in */tmp/$key*) echo yes;; *) echo no;; esac)"
  echo "  live squeal daemon for root: ${daemon:-none}"
done
