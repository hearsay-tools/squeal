#!/bin/sh
# Runs a command with a minimal environment: no CEZ_*, CLAUDE*, CODEX* or SQUEAL* variable reaches it.
# Usage: clean.sh <cwd> <command...>
cd "$1" || exit 1; shift
exec env -i HOME="$HOME" PATH="$PATH" USER="$USER" LANG="${LANG:-C.UTF-8}" TERM=dumb "$@"
