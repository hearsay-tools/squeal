# 011-150 probe (throwaway): files at a commit and a regex walk of static and dynamic imports
# (type-only imports dropped, as the transform drops them), with resolvers for squeal and cezar.
# Checked against Vitest's stored graph by routes.py ("walk" line). Exec'd with `tree` (a
# checkout) and `commit` defined; gives `files`, `resolve(frm, spec)` and `reach(test)`.
import os, re, subprocess
def tree_files(tree, commit):
    return set(subprocess.run(["git", "-C", tree, "ls-tree", "-r", "--name-only", commit],
                           capture_output=True, text=True, check=True).stdout.split("\n")) - {""}
files = tree_files(tree, commit)
_cat = subprocess.Popen(["git", "-C", tree, "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
def blob(p):
    _cat.stdin.write(f"{commit}:{p}\n".encode()); _cat.stdin.flush()
    head = _cat.stdout.readline().split()
    if len(head) < 3 or head[1] != b"blob": return ""
    data = _cat.stdout.read(int(head[2])); _cat.stdout.read(1)
    return data.decode("utf8", "replace")

# ---- static import walk (regex; resolvers for squeal and cezar) ----
TYPE_ONLY = re.compile(r'(?:import|export)\s+type\s+[^;]*?from\s*["\'][^"\']+["\']')  # dropped by the transform
IMP = re.compile(r'(?:from\s+|import\s*\(\s*|import\s+|require\(\s*|vi\.mock\(\s*)["\']([^"\']+)["\']')
PKG = {"@open-mercato/cezar-contract": "packages/contract/src", "@open-mercato/cezar-api-client": "packages/api-client/src"}
def resolve(frm, spec):
    if spec.startswith("."): base = os.path.normpath(os.path.join(os.path.dirname(frm), spec))
    elif spec.startswith("@/"): base = "packages/web/src/" + spec[2:]
    elif spec in PKG: base = PKG[spec] + "/index"
    elif any(spec.startswith(k + "/") for k in PKG):
        k = next(k for k in PKG if spec.startswith(k + "/")); base = PKG[k] + "/" + spec[len(k) + 1:]
    elif spec == "@wjarka/cezarion": base = "packages/cezar/src/index"
    else: return None
    stem = re.sub(r"\.(m|c)?js$", "", base)
    for c in (base, stem + ".ts", stem + ".tsx", stem + ".mts", stem + ".cts", base + ".ts", base + ".tsx",
              base + "/index.ts", base + "/index.tsx", base + ".mjs", base + ".js", base + ".cjs"):
        if c in files: return c
    return None
src_cache, reach_cache = {}, {}
def text(p):
    if p not in src_cache:
        src_cache[p] = blob(p) if p in files else ""
    return src_cache[p]
def reach(t):
    if t in reach_cache: return reach_cache[t]
    seen, todo = {t}, [t]
    while todo:
        m = todo.pop()
        for s in IMP.findall(TYPE_ONLY.sub("", text(m))):
            r = resolve(m, s)
            if r and r not in seen: seen.add(r); todo.append(r)
    reach_cache[t] = seen; return seen

