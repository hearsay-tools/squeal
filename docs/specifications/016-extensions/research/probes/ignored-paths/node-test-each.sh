#!/usr/bin/env bash
# Throwaway (016-19). Run under run.sh: runs each node:test file in its own
# `node <argv> --test <file>` from <cwd>, four at a time, with SQUEAL_OBSERVE's `file`
# set to that test file, so the recorder attributes the process and its children to it.
# Usage: node-test-each.sh <cwd> "<node argv>" <file>...
set -uo pipefail
cwd=$1 argv=$2; shift 2
export cwd argv
printf '%s\n' "$@" | xargs -P 4 -I{} bash -c '
  f=$(realpath "{}")
  settings=${SQUEAL_OBSERVE%\}},\"file\":\"$f\"}
  cd "$cwd" && SQUEAL_OBSERVE=$settings node $argv --test "$f" >/dev/null 2>&1
  echo "$? {}"'
