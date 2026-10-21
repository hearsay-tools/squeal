#!/usr/bin/env python3
# Throwaway probe for research 011-52. Opens each store read-only (mode=ro) and prints, per
# repository since 2026-10-13: worktree activity spans, concurrency, idle gaps, shared commits
# and shared keys. Usage: python3 -I usage.py <common-dir>...
import sqlite3, sys, datetime, collections
SINCE = int(datetime.datetime(2026, 10, 13, tzinfo=datetime.timezone.utc).timestamp() * 1000)
H = 3600_000
def iso(ms): return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%m-%dT%H:%MZ")
for common in sys.argv[1:]:
    db = sqlite3.connect(f"file:{common}/squeal/store.sqlite?mode=ro", uri=True)
    ev = collections.defaultdict(list)   # worktree -> event times (revisions, run starts and ends)
    for w, t in db.execute("select worktree_id, created_at from revisions where created_at>=?", (SINCE,)): ev[w].append(t)
    for w, s, e in db.execute("select worktree_id, started_at, ended_at from runs where started_at>=?", (SINCE,)):
        ev[w].append(s)
        if e: ev[w].append(e)
    revs = collections.defaultdict(list)
    for w, t, h in db.execute("select worktree_id, created_at, head from revisions where created_at>=? order by created_at", (SINCE,)): revs[w].append((t, h))
    roots = dict(db.execute("select id, root from worktrees"))
    print(f"== {common}  worktrees with activity since 10-13: {len(ev)} (in worktrees table now: {len(roots)}); revisions kept for {len(revs)}")
    spans = {w: (min(v), max(v)) for w, v in ev.items()}
    life = sorted((b - a) / H for a, b in spans.values())
    if life:
        q = lambda p: round(life[min(len(life) - 1, int(p * len(life)))], 1)
        print(f"  activity span h (first to last event): n={len(life)} p25={q(.25)} median={q(.5)} p75={q(.75)} p90={q(.9)} max={round(life[-1],1)}")
    # Concurrency: worktrees whose span covers each 10-minute instant.
    if spans:
        lo, hi = min(a for a, _ in spans.values()), max(b for _, b in spans.values())
        conc = []
        t = lo
        while t <= hi:
            conc.append(sum(1 for a, b in spans.values() if a <= t <= b)); t += 600_000
        c = sorted(conc)
        print(f"  live at once (span covers instant, 10-min grid {iso(lo)}..{iso(hi)}): median={c[len(c)//2]} p90={c[int(.9*len(c))]} max={c[-1]}")
        # Busy at once: an event (revision or run) within the last 30 min.
        busy = []
        t = lo
        while t <= hi:
            busy.append(sum(1 for v in ev.values() if any(t - 1800_000 <= x <= t for x in v))); t += 600_000
        b = sorted(busy)
        print(f"  active at once (an event in the last 30 min): median={b[len(b)//2]} p90={b[int(.9*len(b))]} max={b[-1]}")
        # Revision gaps: share of span time in gaps over 30 min with no revision and no run event.
        idle = tot = 0
        for w, v in ev.items():
            v = sorted(v)
            for x, y in zip(v, v[1:]):
                tot += y - x
                if y - x > 1800_000: idle += y - x - 1800_000
        print(f"  span time past 30 min of quiet (no revision, run start or end): {round(100*idle/tot) if tot else 0}% of {round(tot/H)} worktree-hours")
    # Shared commits: revisions whose HEAD another worktree also had within 24 h.
    heads = collections.defaultdict(list)
    for w, v in revs.items():
        for t, h in v:
            if h: heads[h].append((w, t))
    n = shared = 0
    for w, v in revs.items():
        for t, h in v:
            if not h: continue
            n += 1
            if any(o != w and abs(t2 - t) < 24 * H for o, t2 in heads[h]): shared += 1
    print(f"  revisions whose HEAD another worktree had within 24 h: {shared}/{n}")
    # Shared keys now: current test_file_keys rows whose key another worktree also holds.
    rows = db.execute("select count(*), sum(c>1) from (select key, count(distinct worktree_id) c from test_file_keys where key is not null group by key)").fetchone()
    per = db.execute("select count(*) from test_file_keys where key is not null").fetchone()[0]
    sharedrows = db.execute("select coalesce(sum(c),0) from (select count(distinct worktree_id) c from test_file_keys where key is not null group by key having c>1)").fetchone()[0]
    print(f"  current keys: {rows[0]} distinct over {per} worktree rows; {rows[1]} keys held by 2+ worktrees, covering {sharedrows} rows ({round(100*sharedrows/per) if per else 0}%)")
    print(f"  worktrees in test_file_keys: {db.execute('select count(distinct worktree_id) from test_file_keys').fetchone()[0]}")
