"""Probe only: compare run-2 dumps against a reference variant. Usage: compare.py <dumps dir> <version> <reference>."""
import json, os, sys
d, v, ref = sys.argv[1:4]
S = os.path.dirname(os.path.abspath(d))
def load(name):
    with open(os.path.join(d, f"{v}-{name}.json")) as f:
        return json.loads(f.read().replace(S, "<S>"))
base = load(ref)
for fn in sorted(os.listdir(d)):
    if not (fn.startswith(v + "-") and fn.endswith(".json")) or fn == f"{v}-{ref}.json":
        continue
    name = fn[len(v) + 1:-5]
    other = load(name)
    print(f"== {v} {name} vs {ref}")
    for key in base:
        a, b = base[key], other.get(key)
        if a == b:
            continue
        if isinstance(a, list):
            print(f"  {key}: order/content differs" if sorted(a) == sorted(b) else f"  {key}: only in ref {sorted(set(a)-set(b))}; only here {sorted(set(b)-set(a))}")
            if key == "path":
                print("    ref :", a); print("    here:", b)
        elif isinstance(a, dict):
            for k in a:
                if a[k] != b.get(k):
                    print(f"  {key}.{k}: {a[k]} -> {b.get(k)}")
        else:
            print(f"  {key}: {a} -> {b}")
