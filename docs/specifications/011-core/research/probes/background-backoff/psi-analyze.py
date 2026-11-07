"""Summarise psi-sample.py's lines by busy band (throwaway): per band the samples, the median and p75 of CPU pressure
`some` over each 10 s step (host and this user's slice), the run queue per CPU and the nice cores.

Usage: python3 -I psi-analyze.py PSI.jsonl
"""
import collections, json, os, sys
L = [json.loads(l) for l in open(sys.argv[1])]
CPUS = os.cpu_count()
EDGES = [0, 6, 12, 14, 16, 18, 20, 24.1]
q = lambda a, p: sorted(a)[int(p * (len(a) - 1))] if a else None
g = collections.defaultdict(list)
for x in L:
    for lo, hi in zip(EDGES, EDGES[1:]):
        if lo <= x["busy"] < hi:
            g[f"{lo:g}-{hi:g}"].append(x)
print(json.dumps({"samples": len(L), "from": min(x["t"] for x in L), "to": max(x["t"] for x in L), "cpus": CPUS}))
for k in sorted(g, key=lambda s: float(s.split("-")[0])):
    v = g[k]
    psi = [x["psiSomeStep"] for x in v if x["psiSomeStep"] is not None]
    sl = [x["slicePsiStep"] for x in v if x["slicePsiStep"] is not None]
    print(json.dumps({"busy": k, "n": len(v), "psiSome_p50_p75": [q(psi, .5), q(psi, .75)], "slicePsi_p50": q(sl, .5),
                      "runningPerCpu_p50": round(q([x["running"] for x in v], .5) / CPUS, 2),
                      "load1PerCpu_p50": round(q([x["load1"] for x in v], .5) / CPUS, 2),
                      "niceCores_p50": q([x["nice"] for x in v], .5), "stealPct_p50": q([x["steal"] for x in v], .5)}))
