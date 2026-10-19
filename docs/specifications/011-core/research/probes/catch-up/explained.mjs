// THROWAWAY probe (011-core/research/catch-up.md). For every retained revision of cezar's store
// copy: how many of its changed paths a HEAD move explains (the path's new blob is its blob at
// the revision's HEAD and differs from its blob at the HEAD before the move), how many are keyed
// (a test file or in some test file's closure), and the rest, which an agent or a tool wrote.
// Git is read only (`git ls-tree`) in cezar's repository; the store copy is read-only.
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const REPO = process.argv[3] ?? "/home/agent/projects/cezar";
const db = new DatabaseSync(process.argv[2] ?? "/tmp/r3/cezar-store.sqlite", { readOnly: true });
const keyed = new Set();
for (const t of db.prepare("select path, closure_paths from test_files").all()) { keyed.add(t.path); for (const p of JSON.parse(t.closure_paths)) keyed.add(p); }
const trees = new Map();
function tree(head) {
  if (!trees.has(head)) {
    let m = null;
    try {
      m = new Map(execFileSync("git", ["-C", REPO, "ls-tree", "-r", "-z", head], { maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean)
        .map((l) => { const [meta, path] = l.split("\t"); return [path, meta.split(" ")[2]]; }));
    } catch { m = null; }
    trees.set(head, m);
  }
  return trees.get(head);
}
const revs = db.prepare("select worktree_id, number, created_at, head, trigger, changes from revisions order by worktree_id, number").all();
const out = [];
let prev = null, base = null, moveAt = null;
for (const r of revs) {
  const same = prev !== null && prev.worktree_id === r.worktree_id;
  if (!same) { base = null; moveAt = null; }
  const moved = same && prev.head !== r.head;
  if (moved) { base = prev.head; moveAt = r.created_at; }
  const changes = JSON.parse(r.changes);
  const kchg = changes.filter((c) => keyed.has(c.path));
  let explained = null, keyedExplained = null;
  // The move's revision, and revisions on the same HEAD within 10 s of it (a pull's writes split by the debounce).
  const inMove = base !== null && (moved || (r.created_at - moveAt <= 10_000));
  if (inMove) {
    const now = tree(r.head), before = tree(base);
    if (now && before) {
      const ok = (c) => (now.get(c.path) ?? null) === c.newHash && (before.get(c.path) ?? null) !== c.newHash;
      explained = changes.filter(ok).length;
      keyedExplained = kchg.filter(ok).length;
    }
  }
  out.push({ wt: r.worktree_id.slice(0, 8), n: r.number, at: new Date(r.created_at).toISOString().slice(5, 19), trigger: r.trigger, moved, inMove,
    changed: changes.length, keyed: kchg.length, explained, keyedExplained, keyedUnexplained: keyedExplained === null ? kchg.length : kchg.length - keyedExplained });
  prev = r;
}
writeFileSync("results/explained.json", JSON.stringify(out, null, 1));
console.log("revisions in a HEAD move (moved, or same HEAD within 10 s of the move):");
for (const o of out.filter((o) => o.inMove)) console.log(`  ${o.wt} r${o.n} ${o.at} ${o.trigger}${o.moved ? " moved" : " follow-up"}: changed ${o.changed}, keyed ${o.keyed}, explained ${o.explained ?? "n/a (commit gone)"} (keyed ${o.keyedExplained ?? "n/a"}), keyed unexplained ${o.keyedUnexplained}`);
