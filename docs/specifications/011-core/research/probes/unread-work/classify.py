"""Who read each background test file run: classes 1-4 of research/unread-work.md. Throwaway, read only.

Usage: python3 -I classify.py RUNS SESSIONS REMOVALS SAR EXCLUDE OUT.jsonl
  RUNS      extract.mjs output (all projects)
  SESSIONS  ../manual-mode/sessions.py output (per session: root and event times)
  REMOVALS  removals.mjs output (Cezar task databases)
  SAR       `sadf -d -U saDD -- -u` lines
  EXCLUDE   id8 of the measuring worktree, left out
Env: START, END (ISO, run start window), GAP_MIN (session idle gap that ends an activity span, default 30).

Unit: a record = one test file's module seconds in one ended run (report.json fileDurations).
Kind: checkpoint `baseline` / `run-all`; no checkpoint = `edit` when the first run of its worktree and revision
with at most 4 files, else `backlog` (load-slowdown.md's rule). Background = baseline + backlog.

Per record (all `inferred` proxies; the store records no reader):
- root: the run's worktree root, by sha256(realpath)[:16] (src/core/fs/git-layout.ts) over every root the
  transcripts, Cezar's task databases and the stores name.
- nosession: the run lies outside every activity span of every session in its root (a span ends at a gap of
  GAP_MIN minutes between events). `nosession_any`: outside [first, last event] of every session.
- next_ev: the first session event in the root after the run ended (any tool call, prompt or Stop: each one
  delivers Squeal's hook state); `next_strict`: the first Stop, `squeal status --wait`/`run` or FAIL message.
- sup: the start of the next run of the same file in the same worktree (a later key or a re-run replaced it).
- rm: the worktree's removal (Cezar destroy request; else the task's finish when the path is gone).
- read_local: next_ev < min(sup, rm).
- read_other: the record's result row survives and another worktree holds its key now (test_file_keys), or the
  row's last_used_at is over 120 s after the producing worktree's last activity (last run end, heartbeat, removal).
- unread = neither. Sub-classes in order: removed before any event, superseded before any event, no later event.
"""
import bisect, collections, hashlib, json, os, sys
from datetime import datetime, timezone

RUNS, SESS, REM, SAR, EXCL, OUT = sys.argv[1:7]
iso = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000
START = iso(os.environ.get("START", "2026-10-31T20:00:00Z"))
END = iso(os.environ.get("END", "2026-11-07T08:20:00Z"))
GAP = float(os.environ.get("GAP_MIN", "30")) * 60_000
CPUS = 24
wid = lambda root: hashlib.sha256(root.encode()).hexdigest()[:16]

# sar: busy vCPUs per 10-minute sample
sar = []
for line in open(SAR):
    x = line.strip().split(";")
    if len(x) < 10 or "RESTART" in line:
        continue
    iv, ts = int(x[1]), int(x[2])
    sar.append((ts - iv, ts, CPUS * (100 - float(x[9])) / 100))
sar.sort(key=lambda s: s[1])
sar_end = [s[1] for s in sar]


def busy(t_ms):
    t = t_ms / 1000
    i = bisect.bisect_left(sar_end, t)
    return sar[i][2] if i < len(sar) and sar[i][0] <= t <= sar[i][1] else None


# roots
roots = {}
for p in ("squeal", "cezar", "toolkit-dev"):
    r = f"/home/agent/projects/{p}"
    roots[wid(r)] = r
rm = {}
for line in open(REM):
    r = json.loads(line)
    roots[wid(r["root"])] = r["root"]
    t = r["destroyAt"] or (r["finished"] if not r["exists"] else None)
    if t and not r["exists"]:
        rm[r["root"]] = t
sessions = collections.defaultdict(list)  # root -> list of event-time lists (ms)
ev_all = collections.defaultdict(list)
ev_strict = collections.defaultdict(list)
for line in open(SESS):
    s = json.loads(line)
    root = s["root"]
    roots[wid(root)] = root
    ts = [e[0] * 1000 for e in s["events"]]
    sessions[root].append(ts)
    ev_all[root].extend(ts)
    ev_strict[root].extend(e[0] * 1000 for e in s["events"] if e[1] in ("stop", "ask", "fail"))
for d in (ev_all, ev_strict):
    for k in d:
        d[k].sort()
spans = collections.defaultdict(list)  # gap-split activity spans
whole = collections.defaultdict(list)  # [first, last] per session
for root, ss in sessions.items():
    for ts in ss:
        ts = sorted(ts)
        whole[root].append((ts[0], ts[-1]))
        a = b = ts[0]
        for t in ts[1:]:
            if t - b > GAP:
                spans[root].append((a, b))
                a = t
            b = t
        spans[root].append((a, b))
for d in (spans, whole):
    for k in d:
        d[k].sort()


def overlaps(iv, s, e):
    return any(a <= e and b >= s for a, b in iv)


def after(lst, t):
    i = bisect.bisect_right(lst, t)
    return lst[i] if i < len(lst) else None


# runs
wts, runs = {}, []
for line in open(RUNS):
    r = json.loads(line)
    if "worktree" in r:
        w = r["worktree"]
        roots[w["id"]] = w["root"]
        wts[(r["project"], w["id"])] = w
        continue
    runs.append(r)
runs.sort(key=lambda r: r["start"])
seen, last_act = set(), collections.defaultdict(int)
for r in runs:
    if r["cp"] in ("baseline", "run-all"):
        r["kind"] = r["cp"]
    elif r["cp"] is None:
        k = (r["project"], r["wt"], r["revision"])
        r["kind"] = "edit" if k not in seen and r["picked"] <= 4 else "backlog"
    else:
        r["kind"] = "baseline" if r["cp"] == "gone" else r["cp"]
    seen.add((r["project"], r["wt"], r["revision"]))
    last_act[(r["project"], r["wt"])] = max(last_act[(r["project"], r["wt"])], r["end"])
for k, w in wts.items():
    last_act[k] = max(last_act[k], w.get("daemon_heartbeat_at") or 0)
# next start of the same file in the same worktree
starts = collections.defaultdict(list)
for r in runs:
    for f in r["files"]:
        starts[(r["project"], r["wt"], f[0])].append(r["start"])

out = open(OUT, "w")
for r in runs:
    if not (START <= r["start"] < END):
        continue
    root = roots.get(r["wt"]) or r["root"]
    if root and EXCL in root:
        continue
    s, e = r["start"], r["end"]
    removed = rm.get(root) if root else None
    la = max(last_act[(r["project"], r["wt"])], removed or 0)
    nev = after(ev_all.get(root, []), e) if root else None
    nst = after(ev_strict.get(root, []), e) if root else None
    nos = (not overlaps(spans.get(root, []), s, e)) if root else None
    nos_any = (not overlaps(whole.get(root, []), s, e)) if root else None
    b = busy((s + e) / 2)
    for f in r["files"]:
        name, ms, lu, rec, fails, others = f
        st = starts[(r["project"], r["wt"], name)]
        i = bisect.bisect_right(st, s)
        sup = st[i] if i < len(st) else None
        lim = min(x for x in (sup, removed, 1e18) if x is not None)
        read_local = nev is not None and nev < lim
        read_strict = nst is not None and nst < lim
        read_other = lu is not None and ((others or 0) > 0 or lu > la + 120_000)
        if read_local:
            why = "read"
        elif removed is not None and (nev is None or removed <= nev) and (sup is None or removed <= sup):
            why = "removed"
        elif sup is not None and (nev is None or sup <= nev):
            why = "superseded"
        else:
            why = "no-later-event"
        out.write(json.dumps({
            "p": r["project"], "wt": r["wt"], "root": root, "kind": r["kind"], "run": r["id"], "f": name,
            "s": s, "e": e, "sec": ms / 1000, "busy": b, "nos": nos, "nos_any": nos_any, "nev": nev, "nst": nst,
            "sup": sup, "rm": removed, "why": why, "read_strict": read_strict, "other": read_other,
            "row": lu is not None, "others": others, "fails": fails,
        }) + "\n")
