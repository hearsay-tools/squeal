// 011-157 probe (throwaway), question 5: stored file failures at clean commits on the default branch in the window: what a linked worktree's
// lookup would hold and not show (another worktree's fail is held until a local run confirms it, `heldFailure`).
// Usage: node mainfails.mjs <store copy> <repo root> <copy ms>
import { DatabaseSync } from "node:sqlite"; import { execFileSync } from "node:child_process";
const [, , storePath, root, copyArg] = process.argv; const since = Number(copyArg) - 72 * 3600_000;
const db = new DatabaseSync(storePath, { readOnly: true });
const rows = db.prepare("SELECT c.project || ' ' || c.test_path f, r.outcome, r.commit_sha c, r.recorded_at at FROM results r JOIN checks c ON c.id = r.check_id WHERE c.kind = 'file' AND r.dirty = 0 AND r.commit_sha IS NOT NULL AND r.recorded_at >= ?").all(since);
const onMain = new Map(); const isOn = (c) => { if (!onMain.has(c)) { try { execFileSync("git", ["--git-dir", root + "/.git", "merge-base", "--is-ancestor", c, "origin/main"]); onMain.set(c, true); } catch { onMain.set(c, false); } } return onMain.get(c); };
const main = rows.filter((r) => isOn(r.c)); const fails = main.filter((r) => r.outcome === "fail");
console.log(`clean file results in the window ${rows.length}; at commits on origin/main ${main.length}, of them fail ${fails.length} in ${new Set(fails.map((r) => r.f)).size} files at ${new Set(fails.map((r) => r.c)).size} commits`);
for (const f of [...new Set(fails.map((r) => r.f))].slice(0, 10)) console.log("  ", f);
