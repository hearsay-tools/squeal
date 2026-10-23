# 011-149 probe (throwaway): real edits of code files from a store copy, with blob availability.
# Usage: python3 -I corpus.py <store copy> <git dir> <out.tsv>
import json, re, sqlite3, subprocess, sys
store, gitdir, out = sys.argv[1:4]
db = sqlite3.connect(f"file:{store}?mode=ro", uri=True)
CODE = re.compile(r"\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$")
rows = []
for w, n, t, trig, changes in db.execute("select worktree_id, number, created_at, trigger, changes from revisions where trigger='watch' order by created_at"):
    ch = json.loads(changes)
    for c in ch:
        p = c["path"]
        if not CODE.search(p) or "node_modules/" in p or p.startswith("docs/") or "/dist/" in p or p.startswith("dist/"):
            continue
        rows.append([w, str(n), str(t), str(len(ch)), p, c.get("oldHash") or "", c.get("newHash") or ""])
hashes = sorted({h for r in rows for h in r[5:7] if h})
res = subprocess.run(["git", "--git-dir", gitdir, "cat-file", "--batch-check=%(objectname) %(objecttype)"],
                     input="\n".join(hashes) + "\n", capture_output=True, text=True).stdout.splitlines()
have = {l.split()[0] for l in res if l.endswith(" blob")}
with open(out, "w") as f:
    for r in rows:
        f.write("\t".join(r + ["1" if r[5] in have else "0", "1" if r[6] in have else "0"]) + "\n")
both = [r for r in rows if r[5] in have and r[6] in have]
print(f"code path edits {len(rows)}, both blobs in git {len(both)}, revisions {len({(r[0], r[1]) for r in rows})}")
