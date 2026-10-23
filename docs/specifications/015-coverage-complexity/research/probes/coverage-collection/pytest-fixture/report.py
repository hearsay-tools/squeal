# Throwaway (015-01): lines per context, per measured file.
import sys

import coverage

data = coverage.CoverageData(sys.argv[1])
data.read()
for ctx in sorted(data.measured_contexts()):
    data.set_query_contexts([ctx] if ctx else [""])
    out = {}
    for f in sorted(data.measured_files()):
        if "/pkg/" in f:
            out[f.split("/pkg/")[1]] = sorted(data.lines(f) or [])
    print(repr(ctx), out)
