# Throwaway probe for research/issue-105-findings.md. Reads a COPY of a store, never a live one.
#   keys.py <store copy> <out.json>      revisions and per-file keys of the store's one worktree
#   keys.py --diff <before.json> <after.json>   new revisions with their paths, and moved keys
#   keys.py --observed <store copy>      the observed sets, per project and test file
import json
import sqlite3
import sys


def connect(path):
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def dump(store, out):
    c = connect(store)
    revs = [
        {"n": n, "trigger": t, "dirty": d, "paths": [x["path"] for x in json.loads(ch)]}
        for n, t, d, ch in c.execute(
            "select number, trigger, dirty, changes from revisions order by number"
        )
    ]
    keys = {
        f"{p}:{f}": {"key": k, "rev": r, "pending": pend}
        for p, f, k, r, pend in c.execute(
            "select project, path, key, revision, pending from test_file_keys"
        )
    }
    json.dump({"revisions": revs, "keys": keys}, open(out, "w"), indent=1)
    print(f"revision {revs[-1]['n'] if revs else 0}; {len(keys)} keyed files")


def diff(before, after):
    a, b = json.load(open(before)), json.load(open(after))
    seen = {r["n"] for r in a["revisions"]}
    for r in b["revisions"]:
        if r["n"] not in seen:
            print(f"  new revision {r['n']} ({r['trigger']}, dirty={r['dirty']}): {r['paths']}")
    moved = [
        f
        for f in sorted(set(a["keys"]) | set(b["keys"]))
        if (a["keys"].get(f) or {}).get("key") != (b["keys"].get(f) or {}).get("key")
        or (a["keys"].get(f) or {}).get("pending") != (b["keys"].get(f) or {}).get("pending")
    ]
    for f in moved:
        x, y = a["keys"].get(f) or {}, b["keys"].get(f) or {}
        print(
            f"  key moved {f}: {str(x.get('key'))[:10]}->{str(y.get('key'))[:10]}"
            f" pending {str(x.get('pending'))[:10]}->{str(y.get('pending'))[:10]}"
        )
    if not moved:
        print("  no key moved")


def observed(store):
    c = connect(store)
    for k, v in c.execute("select key, value from meta where key like 'observed%' order by key"):
        for f, ps in sorted(json.loads(v).items()):
            print(f"  {k} {f}: {ps}")


if sys.argv[1] == "--diff":
    diff(sys.argv[2], sys.argv[3])
elif sys.argv[1] == "--observed":
    observed(sys.argv[2])
else:
    dump(sys.argv[1], sys.argv[2])
