#!/bin/sh
# Throwaway (026 agent37-sandboxes). cpu.mjs for <seconds> with /proc/stat steal before and after.
export PATH=$HOME/.local/bin:$PATH
echo "stat before: $(head -1 /proc/stat)"
node /tmp/cpu.mjs ${1:-60}
echo "stat after: $(head -1 /proc/stat)"
