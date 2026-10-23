# Throwaway probe (015-02): are two coverage-v8 runs of the same tests equal as hit/miss per statement,
# branch and function (what CRAP reads), and as raw counts?
import json, sys
a, b = (json.load(open(p)) for p in sys.argv[1:3])
hitdiff = rawdiff = total = 0; where = []
for path in a:
    for kind in ("s", "f", "b"):
        for k, va in a[path][kind].items():
            vb = b[path][kind][k]
            va, vb = (va if isinstance(va, list) else [va]), (vb if isinstance(vb, list) else [vb])
            for x, y in zip(va, vb):
                total += 1
                if (x > 0) != (y > 0):
                    hitdiff += 1; where.append(f"{path.split('/src/')[1]} {kind}{k}: {x} vs {y}")
                elif x != y: rawdiff += 1
print(json.dumps({"counters": total, "hitMissDiffers": hitdiff, "onlyCountDiffers": rawdiff, "examples": where[:8]}))
