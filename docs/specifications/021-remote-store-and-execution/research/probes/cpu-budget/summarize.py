"""Throwaway (row 021-06): replay.py output as one table row per policy, each figure against `none` of the same file.
Usage: python3 -I summarize.py OUT.jsonl"""
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if '"policy"' in l]
base = next((r for r in rows if r["policy"].split()[0] == "none"), rows[0])
pct = lambda a, b: f"{100 * (a - b) / b:+.1f}%" if b else "-"
print("| policy | Squeal CPU h | bg CPU h | bg CPU per work | stale / removed / deferred work h | host >16/18/20 % | others' slowdown | tier finish p50/p90 s | by arrival >20: p50/p90 s | chain finish p50/p90 min (work-weighted) | edit wall h | edit p50/p90 s | agents' wall h |")
print("|" + "---|" * 13)
for r in rows:
    print(f"| {r['policy']} | {r['squealCpuH']} ({pct(r['squealCpuH'], base['squealCpuH'])}) | {r['bgCpuH']} | {r['bgCpuH'] / r['bgWorkDoneH']:.3f} | "
          f"{r['droppedStaleH']} / {r['droppedRemovedH']} / {r.get('deferredWorkH', '-')} | {' / '.join(map(str, r['hostTimeAbove16_18_20']))} | {r['othersSlowdown']} | "
          f"{r['tierFinishS_p50_p90_p99'][0]} / {r['tierFinishS_p50_p90_p99'][1]} | {r['tierFinishS_byArrivalBand_p50_p90']['>20'][0]} / {r['tierFinishS_byArrivalBand_p50_p90']['>20'][1]} | "
          f"{' / '.join(map(str, r['chainFinishMinWorkWeighted_p50_p90']))} | {r['editWallH'][1]} ({pct(r['editWallH'][1], base['editWallH'][1])}) | "
          f"{' / '.join(map(str, r['editWallS_p50_p90']))} | {r['agentWallH'][1]} ({pct(r['agentWallH'][1], base['agentWallH'][1])}) |")
