# 011-143 probe (throwaway): of the test files an edit re-keys, which ran a changed line.
# Usage: python3 -I reach.py <store copy> <edits.tsv> <lines.jsonl> <repo git dir> <checkout at coverage commit> <out.json>
# edits.tsv: worktree, revision, created_at, head, path, oldHash, newHash (from cand.cjs).
import difflib, json, re, sqlite3, subprocess, sys, os
store, edits_tsv, lines_jsonl, gitdir, head_tree, out = sys.argv[1:7]
db = sqlite3.connect(f"file:{store}?mode=ro", uri=True)
closures = {}
for project, path, cp in db.execute("select project, path, closure_paths from test_files"):
    closures[path] = set(json.loads(cp))
dur = {}
for path, d in db.execute("""select c.test_path, sum((select duration_ms from results r where r.check_id = c.id
                              order by recorded_at desc limit 1)) from checks c group by 1"""):
    dur[path] = (d or 0) / 1000
cov = {}
for line in open(lines_jsonl):
    j = json.loads(line)
    cov.setdefault(j["testPath"], {}).update({p: set(v) for p, v in j["lines"].items()})
revs = {}
for w, n, t, changes in db.execute("select worktree_id, number, created_at, changes from revisions"):
    revs.setdefault(w, []).append((n, t, [c["path"] for c in json.loads(changes)]))
for w in revs: revs[w].sort()

def blob(h):
    return subprocess.run(["git", "--git-dir", gitdir, "cat-file", "-p", h], capture_output=True, text=True).stdout.splitlines()

def changed_old_lines(old, new):
    ch = set()
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
        if tag in ("replace", "delete"): ch.update(range(i1 + 1, i2 + 1))
        elif tag == "insert": ch.update(x for x in (i1, i1 + 1) if 1 <= x <= len(old))
    # blank and comment-only lines execute nothing; keep the code lines of the change
    return {l for l in ch if old[l - 1].strip() and not re.match(r"\s*(//|\*|/\*|#)", old[l - 1])}, ch

def map_lines(old, head, ls):
    m = {}
    for a, b, size in difflib.SequenceMatcher(None, old, head, autojunk=False).get_matching_blocks():
        for k in range(size): m[a + k + 1] = b + k + 1
    return {m[l] for l in ls if l in m}

results = []
for row in open(edits_tsv):
    w, n, t, headsha, path, oh, nh = row.rstrip("\n").split("\t")
    n = int(n)
    hp = os.path.join(head_tree, path)
    if not oh or not nh or not os.path.exists(hp): continue
    old, new = blob(oh), blob(nh)
    head = open(hp, encoding="utf8", errors="replace").read().splitlines()
    code_lines, all_lines = changed_old_lines(old, new)
    mapped = map_lines(old, head, code_lines)
    is_test = bool(re.search(r"\.test\.[cm]?[jt]s$", path))
    rekeyed = sorted(p for p, c in closures.items() if (p == path or path in c) and not p.startswith("test/e2e/"))
    # the revision after n in this worktree that touches each file's closure ends its window
    later = [r for r in revs.get(w, []) if r[0] > n]
    files = []
    for tf in rekeyed:
        c = closures[tf]
        end = next((r[0] for r in later if any(p == tf or p in c for p in r[2])), 10**9)
        trans = db.execute("""select t.from_outcome, t.to_outcome from transitions t join checks k on k.id = t.check_id
                              where t.worktree_id = ? and k.test_path = ? and t.revision >= ? and t.revision < ?""", (w, tf, n, end)).fetchall()
        newfail = any(to == "fail" and fr in ("pass", None) for fr, to in trans)
        ran = db.execute("""select count(*) from results r join checks k on k.id = r.check_id
                            where r.worktree_id = ? and k.test_path = ? and r.revision >= ? and r.revision < ?""", (w, tf, n, end)).fetchone()[0] > 0
        if tf == path: reach = "own"
        elif tf not in cov: reach = "no-coverage-record"
        elif not code_lines: reach = "no-code-line-changed"
        elif not mapped: reach = "change-not-at-coverage-commit"
        else: reach = "executed" if cov[tf].get(path, set()) & mapped else ("module-not-loaded" if path not in cov[tf] else "loaded-not-executed")
        files.append({"tf": tf, "dur": round(dur.get(tf, 0), 2), "reach": reach, "ran": ran, "newFail": newfail})
    results.append({"worktree": w, "revision": n, "path": path, "isTest": is_test, "changedLines": len(all_lines),
                    "codeLines": len(code_lines), "mappedLines": len(mapped), "rekeyed": len(rekeyed), "files": files})
json.dump(results, open(out, "w"))
print(len(results))
