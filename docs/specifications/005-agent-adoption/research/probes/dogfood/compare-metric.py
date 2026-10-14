# Throwaway probe for 005-18 part 3. Not product code.
# Two metric.mjs --json outputs compared per editing session: own runs, own runs outside a
# full-suite gate, test wall minutes and full-suite Vitest runs, overall and for workers, with
# the medians, means and a two-sided Mann-Whitney U test (normal approximation, tie-corrected).
#   python3 -I compare-metric.py <before.json> <after.json>
import json
import math
import sys


def per_session(path, role=None):
    rows = []
    for s in json.load(open(path))["sessions"]:
        if s.get("edits", 0) <= 0 or (role and s.get("role") != role):
            continue
        runs = s.get("runs", [])
        rows.append({
            "own": len(runs),
            "outsideGate": sum(1 for r in runs if r.get("reason") != "gate"),
            "wallMin": sum(r.get("wallMs") or 0 for r in runs) / 60000,
            "fullVitest": sum(1 for r in runs if r.get("runner") == "vitest" and r.get("scope") == "full"),
        })
    return rows


def mann_whitney(a, b):
    both = sorted([(v, 0) for v in a] + [(v, 1) for v in b])
    ranks, i = [0.0] * len(both), 0
    ties = 0.0
    while i < len(both):
        j = i
        while j + 1 < len(both) and both[j + 1][0] == both[i][0]:
            j += 1
        for k in range(i, j + 1):
            ranks[k] = (i + j) / 2 + 1
        t = j - i + 1
        ties += t**3 - t
        i = j + 1
    n1, n2 = len(a), len(b)
    r1 = sum(r for r, (_, g) in zip(ranks, both) if g == 0)
    u1 = r1 - n1 * (n1 + 1) / 2
    mu = n1 * n2 / 2
    n = n1 + n2
    sigma = math.sqrt(n1 * n2 / 12 * ((n + 1) - ties / (n * (n - 1))))
    z = (u1 - mu) / sigma if sigma else 0.0
    p = math.erfc(abs(z) / math.sqrt(2))
    return u1 / (n1 * n2), p  # common-language effect size: P(before > after) + ties/2


def median(v):
    s = sorted(v)
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


before, after = sys.argv[1], sys.argv[2]
for role in (None, "worker", "reviewer"):
    a, b = per_session(before, role), per_session(after, role)
    print(f"== {role or 'all'}: n before {len(a)}, after {len(b)}")
    for k in ("own", "outsideGate", "wallMin", "fullVitest"):
        va, vb = [r[k] for r in a], [r[k] for r in b]
        cl, p = mann_whitney(va, vb)
        print(f"  {k:12s} mean {sum(va) / len(va):6.2f} -> {sum(vb) / len(vb):6.2f}   "
              f"median {median(va):6.2f} -> {median(vb):6.2f}   P(before>after) {cl:.2f}   p {p:.2g}")
