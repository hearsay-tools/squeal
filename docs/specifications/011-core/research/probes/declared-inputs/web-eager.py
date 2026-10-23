# 011-150 probe (throwaway): cezar's web app, the modules every page loads (the walk from
# src/main.tsx without dynamic `import()`) against the whole bundle (with them), and the server
# modules the entry reaches eagerly. A page loads the eager part plus the lazy chunks it opens.
# Usage: python3 -I web-eager.py <checkout> <commit>
import os, re, sys
tree, commit = sys.argv[1:3]
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "walk.py")).read())
STATIC = re.compile(r'(?:from\s+|import\s+|require\(\s*)["\']([^"\']+)["\']')
def eager(t):
    seen, todo = {t}, [t]
    while todo:
        m = todo.pop()
        for s in STATIC.findall(TYPE_ONLY.sub("", blob(m) if m in files else "")):
            r = resolve(m, s)
            if r and r not in seen: seen.add(r); todo.append(r)
    return seen
code = lambda s, pre: {p for p in s if p.startswith(pre) and p.endswith((".ts", ".tsx")) and not re.search(r"\.(test|testkit)\.", p)}
for entry, pre in (("packages/web/src/main.tsx", "packages/web/src/"), ("packages/cezar/src/index.ts", "packages/cezar/src/")):
    full, e = code(reach(entry), pre), code(eager(entry), pre)
    allcode = code(files, pre) - {p for p in files if p.startswith("packages/web/src/test/")}
    print(entry, "non-test code files", len(allcode), "; whole graph", len(full), "; eager", len(e), "; lazy only", len(full - e))
