"""015-14 Round 3, D10: the stop rule for pair 3 (notes.md, "Stop rule").
Pairs 1 and 2 agree when both are complete with the same five edits in both
arms, every edit started at a one-minute load at or under the CPU count in
both arms, and the two pairs' on/off ratios of CPU to the verdict over all
five edits differ by 0.10 or less. Exits 0 when they agree, 1 otherwise, and
prints why.
Usage: python3 -I agree.py <ab.jsonl> [cpus]"""
import json, os, sys

path = sys.argv[1]
cpus = int(sys.argv[2]) if len(sys.argv) > 2 else os.cpu_count()
arms = {}
if os.path.exists(path):
    for line in open(path):
        a = json.loads(line)
        arms[(a['arm'], a['mode'])] = a
ratios = []
for p in ('p1', 'p2'):
    off, on = arms.get((p, 'off')), arms.get((p, 'on'))
    if off is None or on is None:
        sys.exit(print(f'disagree: {p} is not complete') or 1)
    names = [e['name'] for e in off['edits']]
    if len(names) != 5 or names != [e['name'] for e in on['edits']]:
        sys.exit(print(f'disagree: {p} does not hold the same five edits in both arms') or 1)
    over = [e['name'] for e in off['edits'] + on['edits'] if e['load1'] > cpus]
    if over:
        sys.exit(print(f'disagree: {p} has edits over load {cpus}: {over}') or 1)
    ratios.append(sum(e['cpu_to_verdict_s'] for e in on['edits']) / sum(e['cpu_to_verdict_s'] for e in off['edits']))
gap = abs(ratios[0] - ratios[1])
print(f"{'agree' if gap <= 0.10 else 'disagree'}: on/off over five edits p1 {ratios[0]:.3f}, p2 {ratios[1]:.3f}, gap {gap:.3f}")
sys.exit(0 if gap <= 0.10 else 1)
