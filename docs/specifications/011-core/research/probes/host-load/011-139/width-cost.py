"""Throwaway probe for row 011-139. Usage: python3 -I width-cost.py STORE_COPY RUNS_COPY HOURS [END_ISO]

Reads a store copy (taken with its -wal and -shm) and copies of its runs'
report.json. For each run that started in the HOURS before END (default now) and ended with a
report of file durations, it models the tier's wall at W workers with C4
step 5's estimate, sum / W + (1 - 1/W) x longest, and prints per tier size
class the median modelled wall at the widths a cap would leave. Edit-sized
runs are those of at most 4 files (`runner.tierSize`, C4 step 5): an edit's
tier is never larger, a backlog tier can be."""
import datetime, json, os, sqlite3, statistics, sys, time

store, runs, hours = sys.argv[1], sys.argv[2], float(sys.argv[3])
db = sqlite3.connect(f"file:{store}?mode=ro", uri=True)
end = datetime.datetime.fromisoformat(sys.argv[4]).timestamp() if len(sys.argv) > 4 else time.time()
since, until = (end - hours * 3600) * 1000, end * 1000


def wall(ds, w):
    w = max(1, min(w, len(ds)))
    return sum(ds) / w + (1 - 1 / w) * max(ds)


classes = {"edit-sized (1-4 files)": [], "backlog (5+ files)": [], "checkpoint": []}
for rid, cp, n, started, ended in db.execute(
        "select id, checkpoint_id, json_array_length(test_files), started_at, ended_at from runs "
        "where started_at >= ? and started_at < ? and ended_at is not null", (since, until)):
    p = os.path.join(runs, rid, "report.json")
    try:
        rep = json.load(open(p))["report"]
    except (OSError, ValueError, KeyError, TypeError):
        continue
    ds = [f["durationMs"] / 1000 for f in rep.get("fileDurations") or []]
    if not ds:
        continue
    cls = "checkpoint" if cp else "edit-sized (1-4 files)" if n <= 4 else "backlog (5+ files)"
    classes[cls].append({"n": n, "ds": ds, "walls": (ended - started) / 1000})

out = {}
for cls, rs in classes.items():
    if not rs:
        continue
    row = {"runs": len(rs), "filesMedian": statistics.median(r["n"] for r in rs),
           "recordedWallMedianS": round(statistics.median(r["walls"] for r in rs), 1)}
    for w in (16, 13, 8, 4, 2, 1):
        row[f"modelW{w}MedianS"] = round(statistics.median(wall(r["ds"], w) for r in rs), 1)
    # The added wall of a cap, per run, against the run at 4 (an edit tier's width) or 16.
    base = 4 if cls.startswith("edit") else 16
    for w in ((2, 1) if base == 4 else (8, 4)):
        add = sorted(wall(r["ds"], w) - wall(r["ds"], base) for r in rs)
        row[f"addedAtW{w}vsW{base}"] = {"p50": round(add[len(add) // 2], 1),
                                         "p90": round(add[int(0.9 * (len(add) - 1))], 1), "max": round(add[-1], 1)}
    out[cls] = row
print(json.dumps(out, indent=1))
