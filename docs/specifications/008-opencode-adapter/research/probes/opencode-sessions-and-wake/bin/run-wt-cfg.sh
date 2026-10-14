#!/bin/sh
# Throwaway. run.sh from the linked worktree's subdirectory, with OPENCODE_CONFIG_DIR = the probe's cfgdir.
SUBDIR=sub CFGDIR=1 exec sh "$(dirname "$0")/run.sh" "$@"
