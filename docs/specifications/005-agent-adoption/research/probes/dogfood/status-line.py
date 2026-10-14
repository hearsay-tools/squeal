# Throwaway probe for 005-18 part 2. Not product code.
# One line from `squeal status --json` on stdin: revision, check counts, test files without checks,
# known failures, the slow tier, the checkpoint, the daemon state and inherited results.
import json
import sys

try:
    s = json.load(sys.stdin)
except ValueError:
    print("unreadable status")
    sys.exit(0)
c, w = s.get("counts") or {}, s.get("testFilesWithoutChecks") or {}
cp, d, slow = s.get("checkpoint") or {}, s.get("daemon") or {}, s.get("slowTier") or {}
print(f"rev {s.get('revision')} checks current {c.get('current')} pending {c.get('pending')} stale {c.get('stale')} "
      f"unknown {c.get('unknown')} | files without checks pending {w.get('pending')} unknown {w.get('unknown')} "
      f"| known failures {len(s.get('knownFailures') or [])} | slow {slow.get('current')}/{slow.get('testFiles')} "
      f"| checkpoint {cp.get('kind')} {cp.get('done')}/{cp.get('total')} | daemon {d.get('state')} "
      f"| inherited {s.get('inheritedCount')}")
