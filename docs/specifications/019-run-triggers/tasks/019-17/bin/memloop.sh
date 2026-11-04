#!/bin/sh
# Throwaway probe for 019-17: mem.mjs every 5 s for <clone> into <out> until <stopfile> exists.
while [ ! -e "$3" ]; do node /tmp/dogfood-019-17/bin/mem.mjs "$1" >> "$2"; sleep 5; done
