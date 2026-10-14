#!/bin/sh
# Throwaway. Lists this probe's OpenCode cache, data and the repo's .opencode.
. "$(dirname "$0")/env.sh"
cd $W && find xdg repo/.opencode -maxdepth 4 -not -path '*/node_modules/*/*' | head -${1:-60}
