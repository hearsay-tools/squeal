# 011-149 probe (throwaway): emit.mjs output counted per transform: Vitest's pipeline (per project, then all
# projects together), oxc alone, the pairs where the two disagree, Node's type stripping and esbuild.
# Usage: python3 -I classes.py <emit.jsonl>
import collections, json, sys
vite, agree, strip, esb = (collections.Counter() for _ in range(4))
for line in open(sys.argv[1]):
    j = json.loads(line)
    v = tuple(sorted({str(x.get("cls")) for x in j["vite"].values()})); o = tuple(sorted({str(x.get("cls")) for x in j["oxc"].values()}))
    vite[v] += 1
    if v != o: agree[(v, o)] += 1
    s = j["strip"]; strip[s["cls"] if s["cls"] != "n/a" else "n/a: " + str(s.get("err"))[:40]] += 1
    esb[j["esbuild"]["cls"]] += 1
print("pairs", sum(vite.values()))
print("vitest pipeline (classes over the holding projects):", dict(vite.most_common()))
print("pipeline and oxc alone disagree:", dict(agree))
print("node type stripping:", dict(strip.most_common()))
print("esbuild (tsx):", dict(esb.most_common()))
