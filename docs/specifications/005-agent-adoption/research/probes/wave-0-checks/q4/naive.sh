#!/bin/sh
# Throwaway (005-04): an installer written top to bottom, no main function.
echo "step 1: check node"
echo "step 2: install plugins"
printf 'continue? [y/N] '
read answer
echo "answer was: [$answer]"
echo "step 3: copy launcher"
echo "step 4: print next step"
rm_everything_stub() { echo "would remove the launcher"; }
rm_everything_stub --uninstall-complete
echo "DONE naive"
