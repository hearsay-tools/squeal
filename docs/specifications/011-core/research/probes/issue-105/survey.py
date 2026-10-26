# Throwaway probe for research/issue-105-findings.md, questions 3 and 4. Reads a COPY of a store.
#   python3 -I survey.py <store copy> <checkout> <work dir>
# Prints: revisions by size; ignored paths among revision paths, and revisions made of them
# alone; ignored paths in the observed sets with their readers; the ignored files written in
# the last 24 h (main checkout, worktrees and node_modules left out) and which have a reader;
# the revisions that name .ai/qa/test-env.json. Classifies with ignored.py (git check-ignore).
import collections
import datetime
import json
import os
import sqlite3
import subprocess
import sys

store, checkout, work = sys.argv[1:4]
here = os.path.dirname(os.path.abspath(__file__))
os.makedirs(work, exist_ok=True)
c = sqlite3.connect(f"file:{store}?mode=ro", uri=True)


def ignored(paths, name):
    listing = os.path.join(work, name)
    with open(listing, "w") as f:
        f.write("\n".join(paths) + "\n")
    out = subprocess.run(
        ["python3", "-I", os.path.join(here, "ignored.py"), checkout, listing],
        capture_output=True, text=True, check=True,
    ).stdout
    return set(out.split())


def day(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.UTC).strftime("%m-%dT%H:%M")


revs = [
    (wt, n, ts, trig, [x["path"] for x in json.loads(ch)])
    for wt, n, ts, trig, ch in c.execute(
        "select worktree_id, number, created_at, trigger, changes from revisions order by created_at"
    )
]
sizes = collections.Counter(
    "1" if len(p) == 1 else "2-3" if len(p) <= 3 else "4-10" if len(p) <= 10 else "11-100" if len(p) <= 100 else ">100"
    for *_, p in revs
)
print(f"revisions {len(revs)}, from {day(revs[0][2])} to {day(revs[-1][2])}; by paths: {dict(sizes)}")

rev_paths = sorted({p for *_, ps in revs for p in ps})
rev_ign = ignored(rev_paths, "rev-paths.txt")
alone = collections.Counter()
for wt, n, ts, trig, ps in revs:
    if ps and all(p in rev_ign for p in ps):
        alone[("/".join(ps[0].split("/")[:3]), trig, day(ts)[:5])] += 1
print(f"ignored paths among revision paths: {len(rev_ign)}; revisions of ignored paths alone: {sum(alone.values())}")
for k, v in sorted(alone.items()):
    print("  ", v, k)

readers = collections.defaultdict(set)
for key, value in c.execute("select key, value from meta where key like 'observed.%'"):
    for test_file, paths in json.loads(value).items():
        for p in paths:
            readers[p].add(f"{key[9:]}:{test_file}")
obs_ign = ignored([p.rstrip("/") or "." for p in readers], "observed.txt")
print("ignored paths in observed sets, with readers:")
for p, s in sorted(readers.items(), key=lambda x: -len(x[1])):
    if (p.rstrip("/") or ".") in obs_ign:
        print(f"   {len(s)} readers  {p}")

written = subprocess.run(
    ["find", ".", "(", "-path", "./.git", "-o", "-path", "./node_modules", "-o", "-path",
     "./.ai/cezar/worktrees", "-o", "-path", "*/node_modules", ")", "-prune", "-o", "-type", "f",
     "-newermt", "24 hours ago", "-print"],
    cwd=checkout, capture_output=True, text=True,
).stdout.split("\n")
written = [w[2:] for w in written if w.startswith("./")]
w_ign = ignored(written, "written24h.txt")
tops = collections.Counter("/".join(w.split("/")[:3]) for w in w_ign)
print(f"files written in 24 h: {len(written)}, ignored {len(w_ign)}; top: {tops.most_common(8)}")
print(f"  ignored and written in 24 h, with a reader: { {p: len(readers[p]) for p in w_ign if p in readers} }")

env = [(wt, ts, trig, ps) for wt, n, ts, trig, ps in revs if ".ai/qa/test-env.json" in ps]
last, gaps = {}, []
for wt, ts, trig, ps in env:
    if wt in last:
        gaps.append(round((ts - last[wt]) / 1000))
    last[wt] = ts
gaps.sort()
print(
    f"revisions naming .ai/qa/test-env.json: {len(env)}, alone {sum(ps == ['.ai/qa/test-env.json'] for *_, ps in env)},"
    f" worktrees {len(last)}, first {day(env[0][1]) if env else '-'}, by trigger {dict(collections.Counter(t for _, _, t, _ in env))};"
    f" intervals {len(gaps)}: under 15 s {sum(g <= 15 for g in gaps)}, median {gaps[len(gaps) // 2] if gaps else '-'} s"
)
