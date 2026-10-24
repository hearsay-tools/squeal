"""Throwaway probe for row 011-139. Usage: python3 -I analyze-pool.py SAMPLES.jsonl [HOST_SLOTS] [EXCLUDE_WID...]

Reads sample-pool.py's lines. Per sample, per project, it splits each daemon's
tiers by its mark and its locks:

- backlog: the daemon holds pool permits (a backlog or checkpoint lease, 011 C10);
  its test processes beyond its permits are counted as an edit's workers beside it.
- edit: the daemon holds no permit and its mark says `want` 0 (an edit's tier
  only, row 011-98), or it has test processes and no fresh mark at all.

Prints one line per sample, then a JSON summary over the samples whose host busy
cores are at least 18 (the row's threshold)."""
import collections, json, statistics, sys

path = sys.argv[1]
slots = int(sys.argv[2]) if len(sys.argv) > 2 else 16
exclude = set(sys.argv[3:])
BUSY = 18


def project(root):
    if root.startswith("/tmp/"):
        return "tmp"
    parts = root.split("/")
    return parts[4] if len(parts) > 4 and parts[1] == "home" else root


def tests(d):
    kids = d.get("children")
    if kids is None:
        return d["tests"]
    return sum(v for k, v in kids.items() if k != "other")


rows = []
for line in open(path):
    s = json.loads(line)
    per = collections.defaultdict(lambda: {"editCores": 0.0, "editTests": 0, "editDaemons": 0,
                                            "backlogPermits": 0, "backlogCores": 0.0, "backlogTests": 0,
                                            "besideEdits": 0})
    held_by = {}
    edit_mark_held = 0
    for d in s["daemons"]:
        if d["wid"] in exclude:
            continue
        p = project(d["root"])
        n = tests(d)
        mark = d["mark"] if d["mark"] and d["mark"].get("age", 99) < 30 else None
        permits = len(d["permits"])
        if mark is not None and mark["want"] == 0 and permits:
            edit_mark_held += permits
        if permits:
            held_by[d["wid"]] = (p, permits, d["root"])
            per[p]["backlogPermits"] += permits
            per[p]["backlogCores"] += d["cores"]
            per[p]["backlogTests"] += n
            per[p]["besideEdits"] += max(0, n - permits)
        elif n > 0 and (mark is None or mark["want"] == 0):
            per[p]["editCores"] += d["cores"]
            per[p]["editTests"] += n
            per[p]["editDaemons"] += 1
    held = sum(len(v) for v in s["holders"].values())
    fresh = [m for m in s["marks"].values() if m.get("age", 99) < 30]
    # What the CPU gate (row 011-98, cores.ts gatedPermits) reads: the fresh marks' cores and grants.
    gate_cores = round(sum(m.get("cores", m["grant"]) for m in fresh), 2)
    gate_grants = sum(m["grant"] for m in fresh)
    top = max(held_by.values(), key=lambda v: v[1], default=(None, 0, None))
    rows.append({"t": s["t"], "load": float(s["load"][0]), "busy": s["busy"], "nice": s["nice"],
                 "held": held, "gateCores": gate_cores, "gateGrants": gate_grants,
                 "gateOpen": gate_cores < slots or gate_grants < slots / 2, "top": top, "editMarkHeld": edit_mark_held, "per": {k: dict(v) for k, v in per.items()},
                 "squealCores": round(sum(d["cores"] for d in s["daemons"] if d["wid"] not in exclude), 2)})

for r in rows:
    parts = []
    for p, v in sorted(r["per"].items()):
        parts.append(f"{p}: edit {v['editTests']}p {v['editCores']:.1f}c / backlog {v['backlogPermits']}permits "
                     f"{v['backlogTests']}p {v['backlogCores']:.1f}c")
    print(f"{r['t'][11:19]} load {r['load']:5.1f} busy {r['busy']:4.1f} nice {r['nice']:4.1f} squeal {r['squealCores']:4.1f} "
          f"gate {r['gateCores']:4.1f}c {'open' if r['gateOpen'] else 'shut'} held {r['held']:2d} top {r['top'][1]:2d} {r['top'][0] or '-'} | " + "; ".join(parts))


def dist(xs):
    if not xs:
        return None
    xs = sorted(xs)
    return {"mean": round(statistics.mean(xs), 2), "p50": xs[len(xs) // 2], "p90": xs[min(len(xs) - 1, int(0.9 * len(xs)))],
            "max": xs[-1]}


busy = [r for r in rows if r["busy"] >= BUSY]
summary = {"samples": len(rows), "busySamples": len(busy), "slots": slots,
           "first": rows[0]["t"] if rows else None, "last": rows[-1]["t"] if rows else None,
           "load": dist([r["load"] for r in busy]), "busyCores": dist([r["busy"] for r in busy]),
           "squealCores": dist([r["squealCores"] for r in busy]),
           "permitsUnderEditOnlyMarks": sum(r["editMarkHeld"] for r in rows),
           "gateCores": dist([r["gateCores"] for r in busy]),
           "gateOpenShare": round(sum(r["gateOpen"] for r in busy) / len(busy), 3) if busy else None,
           "poolFull": sum(r["held"] >= slots for r in busy),
           "oneWorktreeAll": sum(r["top"][1] >= slots for r in busy),
           "oneWorktreeHalfOrMore": sum(r["top"][1] >= slots / 2 for r in busy),
           "topPermits": dist([r["top"][1] for r in busy]),
           "heldPermits": dist([r["held"] for r in busy]),
           "topHolders": collections.Counter(f"{r['top'][0]} {r['top'][2]}" for r in busy if r["top"][1] >= slots / 2).most_common(5),
           "perProject": {}}
projects = sorted({p for r in busy for p in r["per"]})
for p in projects:
    vals = [r["per"].get(p, {}) for r in busy]
    summary["perProject"][p] = {
        "editTests": dist([v.get("editTests", 0) for v in vals]),
        "editCores": dist([round(v.get("editCores", 0), 2) for v in vals]),
        "samplesWithEdit": sum(v.get("editTests", 0) > 0 for v in vals),
        "editWorkersBesideBacklog": dist([v.get("besideEdits", 0) for v in vals]),
        "backlogPermits": dist([v.get("backlogPermits", 0) for v in vals]),
        "backlogCores": dist([round(v.get("backlogCores", 0), 2) for v in vals]),
    }
print(json.dumps(summary))
