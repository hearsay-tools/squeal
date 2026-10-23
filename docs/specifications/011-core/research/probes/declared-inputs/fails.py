# 011-150 probe (throwaway): every test file that turned to FAIL in the window, with the paths
# that changed in its worktree since its previous result and the route each changed path in
# its closure took (self, import, declared, observed). Per test file and revision one row.
# The paths are the union of the worktree's revisions after the file's previous transition of
# any check (or its previous stored result) up to the FAIL revision. A row whose window holds
# no revision of the store (pruned, or a key change from the environment) says so.
# Usage: python3 -I fails.py <store copy> <config json> <hours> <file regex> <out.json> [checkout commit]
import json, re, sqlite3, sys, os, time
from collections import defaultdict
sys.argv += [None] * 2
store, cfgpath, hours, rx, out, tree, commit = sys.argv[1:8]
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
db = sqlite3.connect(f"file:{store}?mode=ro", uri=True)
cfg = json.load(open(cfgpath)); inputs = cfg.get("inputs", [])
exec(open(os.path.join(here, "globre.py")).read())
rules = [("**", inputs)] if isinstance(inputs, list) else list(inputs.items())
rules = [(tg, glob_re(tg), [(g, glob_re(g)) for g in gs]) for tg, gs in rules if gs]
now_ms = db.execute("select max(at) from transitions").fetchone()[0]
t0 = now_ms - float(hours) * 3600e3
clo = {(p, t): set(json.loads(c)) for p, t, c in db.execute("select project, path, closure_paths from test_files")}
obs = defaultdict(set)
for k, v in db.execute("select key, value from meta where key like 'observed.%' or key like 'nodeTest.observed.%' or key like 'pytest.observed.%'"):
    val = json.loads(v)
    if isinstance(val, dict):
        for t, ps in val.items(): obs[(k.split("observed.", 1)[1], t)].update(ps)
fails = db.execute("""select t.worktree_id, c.project, c.test_path, t.revision, min(t.at), count(*),
    group_concat(distinct coalesce(t.from_outcome, '-'))
    from transitions t join checks c on c.id = t.check_id
    where t.to_outcome = 'fail' and t.at > ? group by 1, 2, 3, 4 order by 5""", (t0,)).fetchall()
rows = []
for wt, proj, path, rev, at, nchecks, froms in fails:
    if not re.search(rx, path): continue
    prev = db.execute("""select max(t.revision) from transitions t join checks c on c.id = t.check_id
        where t.worktree_id = ? and c.project = ? and c.test_path = ? and t.revision < ? and t.to_outcome in ('pass','fail')""",
        (wt, proj, path, rev)).fetchone()[0]
    prev_res = db.execute("""select max(r.revision) from results r join checks c on c.id = r.check_id
        where r.worktree_id = ? and c.project = ? and c.test_path = ? and r.revision < ?""", (wt, proj, path, rev)).fetchone()[0]
    lo = max([x for x in (prev, prev_res) if x is not None], default=None)
    revs = db.execute("select number, trigger, changes from revisions where worktree_id = ? and number > ? and number <= ? order by number",
                      (wt, lo if lo is not None else -1, rev)).fetchall()
    changed = {}
    for n, trig, ch in revs:
        for c in json.loads(ch): changed[c["path"]] = trig
    c = clo.get((proj, path), set())
    inclo = sorted(p for p in changed if p in c or p == path)
    route = {}
    for p in inclo:
        d = [g for tg, tre, gs in rules if tre.match(path) for g, gre in gs if gre.match(p)]
        route[p] = "self" if p == path else ("declared:" + ",".join(d)) if d else "observed" if p in obs[(proj, path)] else "import"
    nxt = db.execute("""select t.to_outcome, t.revision, t.at from transitions t join checks c on c.id = t.check_id
        where t.worktree_id = ? and c.project = ? and c.test_path = ? and t.at > ? and t.to_outcome in ('pass','fail')
        order by t.at limit 1""", (wt, proj, path, at)).fetchone()
    summ = db.execute("""select f.summary from results r join checks c on c.id = r.check_id left join failure_texts f on f.id = r.failure_id
        where r.worktree_id = ? and c.project = ? and c.test_path = ? and r.revision = ? and r.outcome = 'fail' limit 1""",
        (wt, proj, path, rev)).fetchone()
    rows.append({"wt": wt[:8], "project": proj, "file": path, "rev": rev, "at": time.strftime("%m-%dT%H:%MZ", time.gmtime(at / 1000)),
                 "checks": nchecks, "from": froms, "prevRev": lo, "revsBetween": len(revs), "changedPaths": len(changed),
                 "triggers": sorted({t for _, t, _ in revs}), "inClosure": route,
                 "next": None if nxt is None else {"to": nxt[0], "rev": nxt[1], "afterMin": round((nxt[2] - at) / 60000)},
                 "summary": (summ[0] or "")[:200] if summ else None})
json.dump(rows, open(out, "w"), indent=1)
print(len(rows), "file FAIL transitions;", sum(1 for r in rows if not r["inClosure"]), "with no changed closure path in the store")
