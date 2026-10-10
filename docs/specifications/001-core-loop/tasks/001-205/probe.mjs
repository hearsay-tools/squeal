// 001-205 probe (throwaway): four worktrees of one generated Vitest repository start real daemons
// from this worktree's sources together; counts file runs per key across worktrees.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync, openSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [squealRoot, base, countArg] = process.argv.slice(2);
const count = Number(countArg ?? 40);
const main = join(base, "main");
rmSync(base, { recursive: true, force: true });
mkdirSync(join(main, "test"), { recursive: true });
writeFileSync(join(main, ".gitignore"), "node_modules/\n");
writeFileSync(join(main, "package.json"), JSON.stringify({ name: "sr205", private: true, type: "module" }) + "\n");
writeFileSync(join(main, "vitest.config.ts"), `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/*.test.ts"] } });\n`);
for (let i = 0; i < count; i++) {
  writeFileSync(join(main, `test/f${i}.test.ts`), `import { expect, it } from "vitest";\nit("f${i}", async () => { await new Promise((r) => setTimeout(r, 300)); expect(${i}).toBe(${i}); });\n`);
}
const git = (cwd, args) => execFileSync("git", args, { cwd, stdio: "pipe" });
git(main, ["init", "-q", "-b", "main"]);
git(main, ["add", "-A"]);
git(main, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "probe"]);
const roots = [main];
for (let i = 1; i < 4; i++) { const r = join(base, `wt${i}`); git(main, ["worktree", "add", "-q", "-b", `wt${i}`, r]); roots.push(r); }
const runtime = join("/tmp/sr205", "rt"); rmSync(runtime, { recursive: true, force: true }); mkdirSync(runtime, { mode: 0o700 });
const env = { HOME: process.env.HOME, PATH: process.env.PATH, USER: process.env.USER, LANG: "C.UTF-8", XDG_RUNTIME_DIR: runtime };
const cli = join(squealRoot, "src/cli/index.ts");
const t0 = Date.now();
const kids = roots.map((root, i) => spawn(process.execPath, ["--import", "tsx", cli, "daemon", root], { cwd: squealRoot, env, stdio: ["ignore", openSync(`/tmp/sr205/d${i}.log`, "w"), openSync(`/tmp/sr205/d${i}.log`, "a")] }));
const store = join(main, ".git/squeal/store.sqlite");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wall = null;
while (Date.now() - t0 < 10 * 60_000) {
  await sleep(2000);
  if (!existsSync(store)) continue;
  let db;
  try {
    db = new DatabaseSync(store, { readOnly: true });
    db.exec("PRAGMA busy_timeout=5000");
    const rows = db.prepare(`SELECT w.id, (SELECT end_state FROM checkpoints c WHERE c.worktree_id=w.id AND c.kind='baseline' ORDER BY started_at DESC LIMIT 1) base,
      (SELECT count(*) FROM test_file_keys k WHERE k.worktree_id=w.id) files,
      (SELECT count(*) FROM test_file_keys k WHERE k.worktree_id=w.id AND k.pending IS NOT NULL) pending FROM worktrees w`).all();
    console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s ${rows.map((r) => `${r.base ?? "-"}/${r.files}f/${r.pending}p`).join(" ")}`);
    if (rows.length === 4 && rows.every((r) => r.base !== null && r.base !== "open" && r.files === count && r.pending === 0)) { wall = Date.now() - t0; break; }
  } catch (e) { console.log("poll", String(e)); } finally { db?.close(); }
}
const db = new DatabaseSync(store, { readOnly: true });
const runs = db.prepare("SELECT worktree_id, test_files, end_state FROM runs").all();
const per = new Map(); const perWt = new Map();
for (const r of runs) for (const f of JSON.parse(r.test_files)) { const p = f.path ?? f; per.set(p, (per.get(p) ?? 0) + 1); perWt.set(r.worktree_id, (perWt.get(r.worktree_id) ?? 0) + 1); }
const keys = db.prepare("SELECT count(DISTINCT key) n FROM test_file_keys").get().n;
const current = db.prepare("SELECT worktree_id, count(*) n FROM known_states WHERE validity='current' GROUP BY worktree_id").all();
console.log(`wall ${wall === null ? "timeout" : (wall / 1000).toFixed(1) + " s"}; distinct keys ${keys}; file runs ${[...per.values()].reduce((a, b) => a + b, 0)} over ${per.size} files; max runs of one file ${Math.max(...per.values())}`);
console.log(`file runs per worktree: ${[...perWt.values()].join(", ")}; runs by end: ${JSON.stringify(Object.groupBy(runs, (r) => r.end_state ?? "open"), (k, v) => Array.isArray(v) ? v.length : v)}`);
console.log(`current checks per worktree: ${current.map((c) => c.n).join(", ")}`);
db.close();
for (const k of kids) k.kill("SIGTERM");
await Promise.all(kids.map((k) => new Promise((r) => (k.exitCode !== null ? r() : k.on("exit", r)))));
