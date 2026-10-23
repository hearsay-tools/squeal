# 011-149 probe (throwaway): unique (path, old blob, new blob) edits of code files whose two blobs are in git,
# with the store projects whose closures hold the path. Usage: python3 -I pairs.py <store copy> <corpus.tsv> <out.tsv>
import json, sqlite3, sys
store, corpus, out = sys.argv[1:4]
db = sqlite3.connect(f"file:{store}?mode=ro", uri=True)
holders = {}
for project, path, cp in db.execute("select project, path, closure_paths from test_files"):
    for p in set(json.loads(cp)) | {path}:
        holders.setdefault(p, set()).add(project)
seen = {}
for line in open(corpus):
    w, n, t, k, p, o, nw, ho, hn = line.rstrip("\n").split("\t")
    if ho == "1" and hn == "1" and o and nw:
        seen[(p, o, nw)] = sorted(holders.get(p, set()))
with open(out, "w") as f:
    for (p, o, nw), pr in seen.items():
        f.write("\t".join([p, o, nw, ",".join(pr) if pr else "-"]) + "\n")
print(len(seen), sum(1 for v in seen.values() if v))
