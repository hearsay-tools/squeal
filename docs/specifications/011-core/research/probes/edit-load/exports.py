# 011-143 probe (throwaway): of the test files a source edit re-keys, which import a changed export.
# Usage: python3 -I exports.py <reach.json> <edits.tsv> <repo git dir> <checkout> <out.json> <store copy>
# A changed export: an exported top-level declaration whose lines hold a changed code line.
# A change outside every exported declaration (a helper, top-level code) counts as every export changed.
# A test file reaches an export when it, or a module in its static import closure, imports that name (or *)
# from the edited module or from a barrel that re-exports it. Regex parsing; type-only imports count.
import json, os, re, subprocess, sys, difflib
import sqlite3
reach_json, edits_tsv, gitdir, tree, out, store = sys.argv[1:7]
closures = {p: set(json.loads(c)) for p, c in sqlite3.connect(f"file:{store}?mode=ro", uri=True).execute("select path, closure_paths from test_files")}
reach = json.load(open(reach_json))
IMP = re.compile(r'(?:^|\n)\s*(import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+["\']([^"\']+)["\']', re.M)
START = re.compile(r'^(export|import|const|let|var|function|async|class|interface|type|enum|declare|abstract)\b')
EXP = re.compile(r'^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|interface|type|enum|const|let|var|namespace)\s+([A-Za-z_$][\w$]*)')
def resolve(frm, spec):
    if not spec.startswith("."): return None
    base = os.path.normpath(os.path.join(os.path.dirname(frm), spec))
    for c in (base, re.sub(r"\.js$", ".ts", base), re.sub(r"\.mjs$", ".mts", base), base + ".ts", base + "/index.ts", base + ".tsx"):
        if os.path.isfile(os.path.join(tree, c)): return c
    return None
parsed = {}
def imports(m):
    if m in parsed: return parsed[m]
    res = []
    try: text = open(os.path.join(tree, m), encoding="utf8", errors="replace").read()
    except OSError: parsed[m] = res; return res
    for kind, _t, clause, spec in IMP.findall(text):
        tgt = resolve(m, spec)
        if not tgt: continue
        if "*" in clause and "{" not in clause: names = {"*"}
        else:
            inner = re.search(r"\{([^}]*)\}", clause)
            names = {re.split(r"\s+as\s+", n.strip().removeprefix("type ").strip())[0] for n in inner.group(1).split(",") if n.strip()} if inner else {"default"}
        res.append((kind, tgt, names))
    parsed[m] = res; return res
ANY = re.compile(r'(?:from\s+|import\s*\(\s*|import\s+)["\']([^"\']+)["\']')
static = {}
def import_closure(t):
    """the modules t reaches through static, side-effect and literal dynamic imports"""
    if t in static: return static[t]
    seen, todo = {t}, [t]
    while todo:
        m = todo.pop()
        try: text = open(os.path.join(tree, m), encoding="utf8", errors="replace").read()
        except OSError: continue
        for spec in ANY.findall(text):
            r = resolve(m, spec)
            if r and r not in seen: seen.add(r); todo.append(r)
    static[t] = seen; return seen
def users(target, names, seen=None):
    """modules that import one of names from target, directly or through re-exporting barrels"""
    seen = seen or set(); found = set()
    for m in all_modules:
        for kind, tgt, ns in imports(m):
            if tgt != target or not (ns & names or "*" in ns or "*" in names): continue
            if kind == "export" and (m, target) not in seen:
                seen.add((m, target))
                passed = names if "*" in ns else (ns & names if "*" not in names else ns)
                found |= users(m, passed, seen)
            found.add(m)
    return found
all_modules = []
for d in ("src", "test"):
    for root, _, fs in os.walk(os.path.join(tree, d)):
        for f in fs:
            if re.search(r"\.(ts|mts|tsx)$", f): all_modules.append(os.path.relpath(os.path.join(root, f), tree))
edits = {}
for row in open(edits_tsv):
    w, n, t, h, path, oh, nh = row.rstrip("\n").split("\t"); edits[(w, int(n), path)] = (oh, nh)
def blob(h): return subprocess.run(["git", "--git-dir", gitdir, "cat-file", "-p", h], capture_output=True, text=True).stdout.splitlines()
result = []
for e in reach:
    if e["isTest"] or not e["path"].startswith("src/") or not e["codeLines"]: continue
    oh, nh = edits[(e["worktree"], e["revision"], e["path"])]
    old, new = blob(oh), blob(nh)
    changed = set()
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
        if tag in ("replace", "delete"): changed.update(range(i1 + 1, i2 + 1))
        elif tag == "insert": changed.add(max(1, i1))
    starts = [i + 1 for i, l in enumerate(old) if START.match(l)]
    spans = []
    for k, s in enumerate(starts):
        m = EXP.match(old[s - 1]); end = (starts[k + 1] - 1) if k + 1 < len(starts) else len(old)
        spans.append((s, end, m.group(1) if m else None))
    names, internal = set(), False
    for l in changed:
        if not old or not old[l - 1].strip() or re.match(r"\s*(//|\*|/\*)", old[l - 1]): continue
        span = next((sp for sp in spans if sp[0] <= l <= sp[1]), None)
        if span and span[2]: names.add(span[2])
        else: internal = True
    want = {"*"} if internal else names
    us = users(e["path"], want) if want else set()
    by = {"reaches-changed-export": 0, "imports-module-not-changed-export": 0, "no-import-of-module": 0}
    cpu = dict.fromkeys(by, 0.0)
    importers_any = users(e["path"], {"*"})
    for f in e["files"]:
        if f["tf"] == e["path"]: continue
        mods = import_closure(f["tf"])
        k = "reaches-changed-export" if mods & us else ("imports-module-not-changed-export" if mods & importers_any else "no-import-of-module")
        by[k] += 1; cpu[k] += f["dur"]
    result.append({"path": e["path"], "revision": e["revision"], "changedExports": sorted(names), "internalChange": internal, "files": by, "fileSeconds": {k: round(v, 1) for k, v in cpu.items()}})
json.dump(result, open(out, "w"), indent=1)
print(len(result))
