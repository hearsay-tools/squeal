#!/bin/sh
# Throwaway stand-in for a Squeal daemon: heartbeat every second for at most 120 s.
# Usage: fake-daemon.sh <tag>
i=0; while [ $i -lt 120 ]; do echo "$(date +%s) $$ cwd=$(pwd)" >> /tmp/csw/logs/daemon-$1.log; i=$((i+1)); sleep 1; done
