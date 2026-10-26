/*
 * Row 005-83 measurement: the time of a bundled Codex PostToolUse hook whose
 * text registers its consumer, with no copy of its version (it makes one) and
 * with the copy already there. Temporary homes only; a socket that answers the
 * probe's ping stands in for the daemon, so no daemon is spawned.
 * Usage: npx tsx first-copy.mts <worktree> <runs>
 */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { loadavg } from "node:os";
import { join } from "node:path";

const [worktree = "", runsArg = "5"] = process.argv.slice(2);
const runs = Number(runsArg);
const { codexPluginAt } = await import(join(worktree, "test/harness/codex/cache-fixture.ts"));
const { codexRecorded, sessionOf } = await import(join(worktree, "test/harness/codex/helpers.ts"));
const { openStore, isStoreOpenFailure } = await import(join(worktree, "src/core/store/index.ts"));
const { worktreeIdFor } = await import(join(worktree, "src/core/fs/index.ts"));

const A = "0.1.900";
const scratch = mkdtempSync("/tmp/sq-measure-");
const built = join(scratch, "built");
await codexPluginAt(built, A);

function repository(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "README.md"), "kept\n");
  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  const store = openStore(join(dir, ".git"), { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error("store");
  store.close();
  return realpathSync(dir);
}

function answering(path: string): Promise<() => void> {
  const ping = { schemaVersion: 1, ok: true, type: "ping", pid: process.pid, phase: "ready" };
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.once("data", () => socket.end(`${JSON.stringify(ping)}\n`));
    });
    server.listen(path, () => resolve(() => server.close()));
  });
}

function run(bundle: string, input: string, env: Record<string, string>): Promise<{ ms: number; out: string }> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", bundle], { env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += `STDERR ${d}`));
    child.on("error", reject);
    child.on("close", () => resolve({ ms: performance.now() - start, out }));
    child.stdin.end(input);
  });
}

const session = sessionOf("exec", "session-start");
const rows: string[] = [];
for (let i = 0; i < runs; i++) {
  for (const copy of [false, true]) {
    const dir = join(scratch, `m${i}-${copy}`);
    const home = join(dir, "home");
    const root = join(home, ".codex/plugins/cache/hearsay/squeal", A);
    const data = join(home, ".codex/plugins/data/squeal-hearsay");
    cpSync(built, root, { recursive: true });
    const runtime = join(dir, "run");
    mkdirSync(runtime, { recursive: true });
    if (copy) {
      // The copy there already: a first registration in another repository kept it.
      const other = repository(join(dir, "other"));
      const otherRuntime = join(dir, "run-other");
      mkdirSync(otherRuntime, { recursive: true });
      const close = await answering(join(otherRuntime, `squeal-${worktreeIdFor(other)}.sock`));
      await run(join(root, "dist/post-tool-use.mjs"), codexRecorded("exec", "post-tool-use", other, session), {
        XDG_RUNTIME_DIR: otherRuntime, PLUGIN_ROOT: root, PLUGIN_DATA: data, HOME: home, PATH: process.env.PATH ?? "",
      });
      close();
    }
    const repo = repository(join(dir, "repo"));
    const close = await answering(join(runtime, `squeal-${worktreeIdFor(repo)}.sock`));
    const had = existsSync(join(data, "versions", A));
    const { ms, out } = await run(
      join(root, "dist/post-tool-use.mjs"),
      codexRecorded("exec", "post-tool-use", repo, session),
      { XDG_RUNTIME_DIR: runtime, PLUGIN_ROOT: root, PLUGIN_DATA: data, HOME: home, PATH: process.env.PATH ?? "" },
    );
    close();
    const named = out.includes("kept across plugin updates");
    rows.push(`${i}\t${had ? "copy there" : "makes copy"}\t${ms.toFixed(1)} ms\tskill line: ${named}`);
  }
}
console.log(`load ${loadavg().map((l) => l.toFixed(2)).join(" ")}`);
console.log(rows.join("\n"));
rmSync(scratch, { recursive: true, force: true });
