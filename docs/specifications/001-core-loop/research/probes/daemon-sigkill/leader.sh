#!/usr/bin/env bash
# Becomes nothing but `exec "$@"` with SQ180_LEADER set to its own pid; run under setsid,
# so the command it execs leads its own session and group, as the Squeal daemon does.
export SQ180_LEADER=$$
exec "$@"
