# Throwaway probe for 017-13. Not product code.
#   python3 -I report.py <session dir>...
# One timeline per session, in seconds from the session's start (t0 = the first stream line):
# the edits (tool results that wrote a file), the revisions Squeal recorded, the lint
# transitions it stored, and every hook text that names lint. Then the CPU of the daemon's
# worker threads (WorkerThread, the lint worker; V8Worker, its and the daemon's GC helpers):
# from t0 to the session's result, and from the result to the end of the settle wait, plus the
# process RSS at t0, at its peak and at the end. Then verify.json's verdicts, if present.
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from summary import is_edit, load, short  # noqa: E402

LINT = re.compile(r"\blint\b|Lint", re.I)


def jl(path):
    if not os.path.exists(path):
        return []
    return [json.loads(x) for x in open(path) if x.startswith("{")]


def cpu_windows(samples, cuts):
    """Ticks of 1/100 s per thread name between consecutive cut times (epoch ms)."""
    cur = {}
    name = {}
    at_cut = []
    k = 0
    for r in samples:
        if "moved" not in r:
            continue
        while k < len(cuts) and r["t"] > cuts[k]:
            at_cut.append(dict(cur))
            k += 1
        for tid, m in r["moved"].items():
            if "comm" in m:
                name[tid] = m["comm"]
            cur[tid] = m["cpu"]
    while k < len(cuts):
        at_cut.append(dict(cur))
        k += 1
    out = []
    for a, b in zip(at_cut, at_cut[1:]):
        by = {}
        for tid, c in b.items():
            d = (c - a.get(tid, c if tid not in a and False else 0)) / 100
            if tid not in a:
                d = c / 100 if name.get(tid) == "WorkerThread" else 0
            by[name.get(tid, "?")] = round(by.get(name.get(tid, "?"), 0) + d, 2)
        out.append({k: v for k, v in by.items() if v})
    return out


for d in sys.argv[1:]:
    meta = json.load(open(f"{d}/meta.json")) if os.path.exists(f"{d}/meta.json") else {}
    rows, t0 = load(d)
    rel = lambda ms: (ms - t0) / 1000  # noqa: E731
    print(f"=== {meta.get('id', d)} ({meta.get('repo')}) start {meta.get('start')} load {meta.get('loadAtStart')} -> {meta.get('loadAtEnd')}; result at {meta.get('resultS')} s; settle after {(meta.get('settleAfter') or {}).get('s')} s")
    events = []
    for kind, t, name, body, ts in rows:
        if kind == "done" and is_edit(name):
            events.append((t, f"EDIT {short(name)}"))
        if kind == "hook" and LINT.search(body):
            for ln in body.split("\n"):
                if LINT.search(ln):
                    events.append((t, f"HOOK {name}: {ln[:220]}"))
    for r in jl(f"{d}/revisions.jsonl"):
        paths = [c["path"] for c in json.loads(r["changes"])]
        events.append((rel(r["created_at"]), f"REV {r['number']} {r['trigger']} {paths[:3]}{' +' + str(len(paths) - 3) if len(paths) > 3 else ''}"))
    for tr in jl(f"{d}/transitions.jsonl"):
        add = [f"{x.get('rule')}" for x in json.loads(tr["added"])]
        rem = [f"{x.get('rule')}" for x in json.loads(tr["removed"])]
        events.append((rel(tr["at"]), f"TRANSITION #{tr['id']} rev {tr['revision']} {tr['path']} {tr['kind']} +{add} -{rem}"))
    for t, e in sorted(events, key=lambda x: x[0]):
        print(f"  {t:8.2f} {e}")
    samples = jl(f"{d}/samples.jsonl")
    if samples and meta.get("resultS") is not None:
        end_t = max(r["t"] for r in samples)
        cuts = [t0, t0 + int(meta["resultS"] * 1000), end_t]
        w = cpu_windows(samples, cuts)
        # Per transition: the worker's CPU from its revision to its store time, 0.3 s each side
        # (the sampler reads every 250 ms; CPU ticks are 10 ms).
        made = {r["number"]: r["created_at"] for r in jl(f"{d}/revisions.jsonl")}
        for tr in jl(f"{d}/transitions.jsonl"):
            if tr["revision"] in made:
                lo, hi = made[tr["revision"]] - 300, tr["at"] + 300
                print(f"  CPU s, revision {tr['revision']} to transition #{tr['id']} ({(tr['at'] - made[tr['revision']]) / 1000:.2f} s wall): {cpu_windows(samples, [lo, hi])[0]}")
        rss = [(r["t"], r["rssKb"]) for r in samples if r.get("rssKb") is not None]
        print(f"  CPU s, session: {w[0]}; after the result until the settle: {w[1]}")
        if rss:
            print(f"  RSS MB: at t0 {rss[0][1] // 1024}, peak {max(x for _, x in rss) // 1024}, end {rss[-1][1] // 1024}; samples cover {(end_t - t0) / 1000:.0f} s")
    v = f"{d}/verify.json"
    if os.path.exists(v):
        vj = json.load(open(v))
        for r in vj["results"]:
            print(f"  VERIFY #{r['id']} {r['path']} {r['kind']} kindOk={r['kindOk']} addedOk={r['addedOk']} removedOk={r['removedOk']} cliNow={r['cliNow'].get('findings', r['cliNow'])} missing={r['missing']}")
        print(f"  VERIFY finals: {json.dumps({p: x.get('findings', x) for p, x in vj['finals'].items()})[:600]} restored={vj['restored']}")
