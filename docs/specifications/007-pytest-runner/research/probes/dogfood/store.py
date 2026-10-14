"""Throwaway probe for 007-18: read-only queries of a case clone's Squeal store.

    python -I store.py <clone dir> <query> [args]

Queries:
  files        per project: test files keyed in this worktree, files on disk by the include
               globs' plain reading, and the difference
  checks       per project: checks with a known state here, by outcome and origin
  runs [n]     the last n runs (default all): start, end, seconds, files, end state
  batches      per run, the pytest batches' wall times from its log directory, if kept
  transitions  every transition in this worktree
  keys         keyed and unkeyed files, by pending phase
"""

import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path

clone = Path(sys.argv[1]).resolve()
query = sys.argv[2]
args = sys.argv[3:]


def common_dir(clone: Path) -> Path:
    git = clone / ".git"
    if git.is_dir():
        return git
    line = git.read_text().strip().removeprefix("gitdir:").strip()
    wt = (clone / line).resolve()
    common = (wt / "commondir").read_text().strip()
    return (wt / common).resolve()


db = sqlite3.connect(f"file:{common_dir(clone) / 'squeal' / 'store.sqlite'}?mode=ro", uri=True)
wt = db.execute("SELECT id FROM worktrees WHERE root = ?", (str(clone),)).fetchone()
if wt is None:
    sys.exit(f"no worktree row for {clone}")
wt = wt[0]


def ms(t):
    return f"{t / 1000:.1f}"


if query == "files":
    cfg = json.loads((clone / "squeal.config.json").read_text())
    for p in cfg.get("pytest", []):
        name = p["name"]
        cwd = clone / p.get("cwd", ".")
        keyed = {
            r[0]
            for r in db.execute(
                "SELECT path FROM test_file_keys WHERE worktree_id=? AND project=?", (wt, name)
            )
        }
        disk = set()
        for g in p["include"]:
            for f in cwd.glob(g.replace("**/", "**/")):
                rel = str(f.relative_to(clone))
                if "/." in "/" + str(f.relative_to(cwd)):
                    continue
                disk.add(rel)
        print(f"{name}: keyed {len(keyed)}, on disk {len(disk)}")
        for f in sorted(disk - keyed):
            print("  on disk, not keyed:", f)
        for f in sorted(keyed - disk):
            print("  keyed, not on disk:", f)
elif query == "checks":
    rows = db.execute(
        "SELECT c.project, c.kind, k.outcome, k.validity, k.origin_kind FROM known_states k "
        "JOIN checks c ON c.id = k.check_id WHERE k.worktree_id = ?",
        (wt,),
    ).fetchall()
    for key, n in sorted(Counter(rows).items(), key=lambda kv: tuple(map(str, kv[0]))):
        print(n, *key)
elif query == "runs":
    rows = db.execute(
        "SELECT id, revision, test_files, started_at, ended_at, end_state, checkpoint_id FROM runs "
        "WHERE worktree_id = ? ORDER BY started_at",
        (wt,),
    ).fetchall()
    if args:
        rows = rows[-int(args[0]):]
    for rid, rev, files, s, e, state, cp in rows:
        files = json.loads(files)
        dur = f"{(e - s) / 1000:7.1f}" if e else "   open"
        first = files[0] if files else ""
        first = first if isinstance(first, str) else json.dumps(first)
        print(f"{rid[:8]} r{rev} {ms(s)} {dur} s {len(files):3d} files {state} {first[:70]}")
elif query == "transitions":
    rows = db.execute(
        "SELECT t.revision, t.at, t.kind, t.from_outcome, t.to_outcome, c.test_path, c.full_name "
        "FROM transitions t JOIN checks c ON c.id = t.check_id WHERE t.worktree_id = ? ORDER BY t.id",
        (wt,),
    ).fetchall()
    for r in rows:
        print(f"r{r[0]} {ms(r[1])} {r[2]} {r[3]} -> {r[4]} {r[5]}::{r[6]}")
elif query == "keys":
    rows = db.execute(
        "SELECT project, key IS NOT NULL, pending FROM test_file_keys WHERE worktree_id=?", (wt,)
    ).fetchall()
    for key, n in sorted(Counter(rows).items(), key=lambda kv: tuple(map(str, kv[0]))):
        print(n, *key)
else:
    sys.exit(f"unknown query {query}")
