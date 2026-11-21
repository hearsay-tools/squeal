#!/bin/bash
# Alternates base and fix runs, then profiles the fix once.
cd /home/user
for i in 1 2 3; do
  if [ $((i % 2)) = 1 ]; then bash scripts/run-export.sh /home/user/pbase base-$i; bash scripts/run-export.sh /home/user/sq/plugins/claude-code fix-$i
  else bash scripts/run-export.sh /home/user/sq/plugins/claude-code fix-$i; bash scripts/run-export.sh /home/user/pbase base-$i; fi
done
bash scripts/run-export.sh /home/user/sq/plugins/claude-code fix-prof --cpu-prof --cpu-prof-dir=/home/user/proffix
echo PAIRS-DONE
