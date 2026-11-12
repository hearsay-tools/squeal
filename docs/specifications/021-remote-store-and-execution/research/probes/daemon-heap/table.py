#!/usr/bin/env python3
# Throwaway probe for research 021-27. Prints, per edit mark of an inside log, the private memory
# and heap as they stood (mark) and the live heap after the full GC that followed (gc-after).
# Usage: python3 -I table.py <role>-<pid>.jsonl
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1])]
print("mark\tload\tpriv\theapTotal\theapUsed\tliveAfterGC\tprivAfterGC\text\tab\tmalloced")
for i, d in enumerate(rows):
    if not d["label"].startswith("e"): continue
    g = next((r for r in rows[i + 1:] if r["label"] == "gc-after"), None)
    print("\t".join(str(x) for x in [d["label"], d["load1"], d["privMiB"], d["heapTotalMiB"], d["heapUsedMiB"],
          g and g["heapUsedMiB"], g and g["privMiB"], d["externalMiB"], d["arrayBuffersMiB"], d["mallocedMiB"]]))
