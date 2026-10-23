# 011-149 probe (throwaway): replays a store copy's watch revisions with keys on the emitted code.
# A test file keeps its key at a revision when every changed path in its closure (a) emits equal code
# under the variant and (b) is in its closure only as an import: not the test file itself, not a declared
# input, not an observed read. Unknown paths (blob not in git, add, delete, transform error) re-key.
# Variants: K1 code and source-map mappings equal; K2 code equal; K3 code equal after an oxc reprint
# without comments. Own test files count under K1 only (their test locations move otherwise).
# A project named in the optional last argument as name=esbuild keys on esbuild's output (tsx), name=raw on raw bytes.
# Usage: python3 -I replay.py <store copy> <corpus.tsv> <emit.jsonl> <bare.jsonl> <squeal.config.json|-> <since ms> <out.json> [name=esbuild,name=raw]
import json, re, sqlite3, sys
store, corpus, emit, bare, config, since, out = sys.argv[1:8]
runner = dict(x.split("=") for x in sys.argv[8].split(",")) if len(sys.argv) > 8 else {}
since = int(since)
db = sqlite3.connect(f"file:{store}?mode=ro", uri=True)

def glob_re(g):
    i, r = 0, ""
    while i < len(g):
        c = g[i]
        if g.startswith("**/", i): r += "(?:.*/)?"; i += 3; continue
        if g.startswith("**", i): r += ".*"; i += 2; continue
        if c == "*": r += "[^/]*"
        elif c == "?": r += "[^/]"
        elif c == "{":
            j = g.index("}", i); r += "(?:" + "|".join(re.escape(x) for x in g[i + 1:j].split(",")) + ")"; i = j + 1; continue
        else: r += re.escape(c)
        i += 1
    return re.compile("^" + r + "$")
rules = []
if config != "-":
    inputs = json.load(open(config)).get("inputs", [])
    if isinstance(inputs, list): rules = [(re.compile(".*"), [glob_re(g) for g in inputs])]
    else: rules = [(glob_re(t), [glob_re(g) for g in gs]) for t, gs in inputs.items()]
def declared(test, path):
    return any(t.match(test) and any(g.match(path) for g in gs) for t, gs in rules)

closures, observed = {}, {}
for project, path, cp in db.execute("select project, path, closure_paths from test_files"):
    closures[(project, path)] = set(json.loads(cp))
for key, value in db.execute("select key, value from meta where key like 'observed.%'"):
    for test, paths in json.loads(value).items():
        observed[(key[len("observed."):], test)] = set(paths)
holders = {}
for (project, test), c in closures.items():
    for p in c | {test}: holders.setdefault(p, set()).add((project, test))
fdur = {}
for project, path, d in db.execute("""select c.project, c.test_path, (select duration_ms from results r where r.check_id = c.id
                                      order by recorded_at desc limit 1) from checks c where c.kind = 'file'"""):
    fdur[(project, path)] = (d or 0) / 1000

import bisect
fres, ftrans = {}, {}
for project, test, w, rev, d in db.execute("""select k.project, k.test_path, r.worktree_id, r.revision, r.duration_ms from results r
                                             join checks k on k.id = r.check_id where k.kind = 'file'"""):
    fres.setdefault((project, test, w), []).append((rev, d / 1000))
for v in fres.values(): v.sort()
for w, project, test, fr, to, rev, name in db.execute("""select t.worktree_id, k.project, k.test_path, t.from_outcome, t.to_outcome, t.revision, k.full_name
                                                        from transitions t join checks k on k.id = t.check_id"""):
    ftrans.setdefault((project, test, w), []).append((rev, fr, to, name))
def window(m, key, a, b):
    return [x for x in m.get(key, []) if a <= x[0] < b]
cls, ecls = {}, {}
for line in open(emit):
    j = json.loads(line)
    v = [x.get("cls") for x in j["vite"].values()] or [x.get("cls") for x in j["oxc"].values()]
    c = "unknown" if not v or any(x in ("error", "n/a", None) for x in v) else \
        "differs" if "differs" in v or "whitespace-only" in v else "moved" if "same-code-moved" in v else "same"
    cls[(j["path"], j["oldH"], j["newH"])] = c
    e = j["esbuild"]["cls"]
    ecls[(j["path"], j["oldH"], j["newH"])] = "same" if e == "same" else "moved" if e == "same-code-moved" else "differs" if e in ("differs", "whitespace-only") else "unknown"
bare_same = set()
for line in open(bare):
    j = json.loads(line)
    if j.get("bare") == "same": bare_same.add((j["path"], j["oldH"], j["newH"]))

revs = {}
for w, n, t, path, o, nw in ((r[0], int(r[1]), int(r[2]), r[4], r[5], r[6]) for r in (l.rstrip("\n").split("\t") for l in open(corpus))):
    revs.setdefault((w, n, t), []).append((path, o, nw))
allpaths = {}
for w, n, t, changes in db.execute("select worktree_id, number, created_at, changes from revisions"):
    allpaths[(w, n)] = [c["path"] for c in json.loads(changes)]
later = {}
for w, n in allpaths: later.setdefault(w, []).append(n)
for w in later: later[w].sort()

def variant_equal(k, key, project=""):
    how = runner.get(project, "vite")
    if how == "raw": return False
    if how == "esbuild":
        c = ecls.get(key, "unknown")
        return c == "same" if k == "K1" else c in ("same", "moved")
    c = cls.get(key, "unknown")
    if k == "K1": return c == "same"
    if k == "K2": return c in ("same", "moved")
    return c in ("same", "moved") or key in bare_same

V = ("K1", "K2", "K3")
edits, files = [], []
for (w, n, t), changed in sorted(revs.items(), key=lambda x: x[0][2]):
    if t < since: continue
    every = set(allpaths.get((w, n), []))
    code = {p: (p, o, nw) for p, o, nw in changed}
    for p, o, nw in changed:
        edits.append({"w": w, "n": n, "path": p, "small": len(every) <= 3, "cls": cls.get((p, o, nw), "unknown"),
                      "bare": (p, o, nw) in bare_same})
    tests = set()
    for p in every: tests |= holders.get(p, set())
    for (project, test) in tests:
        c = closures[(project, test)] | {test}
        hit = [p for p in every if p in c]
        keep = {}
        for k in V:
            ok = True
            for p in hit:
                own = p == test
                via = "own" if own else "declared" if declared(test, p) else "observed" if p in observed.get((project, test), ()) else "import"
                if p not in code or not variant_equal(k, code[p], project) or (via != "import" and not (via == "own" and k == "K1")):
                    ok = False; break
            keep[k] = ok
        nxt = next((m for m in later[w] if m > n and any(q in c for q in allpaths[(w, m)])), 10**9)
        rr = window(fres, (project, test, w), n, nxt)
        ran = (sum(d for _, d in rr), len(rr))
        trans = [(fr, to, rev, name) for rev, fr, to, name in window(ftrans, (project, test, w), n, nxt)]
        allk = all(p in code and variant_equal("K2", code[p], project) for p in hit)
        known = all(p in code and cls.get(code[p], "unknown") != "unknown" for p in hit)
        files.append({"w": w, "n": n, "t": t, "small": len(every) <= 3, "allK2": allk, "known": known, "project": project, "test": test,
                      "via": sorted({("own" if p == test else "declared" if declared(test, p) else "observed" if p in observed.get((project, test), ()) else "import") for p in hit}),
                      "keep": keep, "dur": round(fdur.get((project, test), 0), 3), "ranS": round(ran[0], 3), "ranN": ran[1],
                      "toFail": [x for x in trans if x[1] == "fail" and x[0] != "fail"], "toPass": [x for x in trans if x[1] == "pass" and x[0] == "fail"]})
json.dump({"edits": edits, "files": files}, open(out, "w"))
print(len(edits), "path edits;", len(files), "re-keyed file revisions")
