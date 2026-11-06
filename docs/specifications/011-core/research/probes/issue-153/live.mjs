// Throwaway isolated daemon probe. Never opens a browser or a real project environment.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir, cpus, loadavg } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const repo = resolve(import.meta.dirname, "../../../../../..");
const cli = join(repo, "plugins/claude-code/dist/cli/squeal.mjs");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function alive(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] !== "Z";
  } catch {
    return false;
  }
}
for (const policy of ["lookup-only", "lookup-then-run-missing"]) {
  const load = loadavg()[0];
  console.log(JSON.stringify({ policy, node: process.version, load, cpus: cpus().length }));
  if (load > cpus().length) break;
  const root = mkdtempSync(join(tmpdir(), "squeal-issue-153-"));
  const marks = join(root, ".git", "marks");
  let stopped = false;
  function run(args) {
    const r = spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 25000,
    });
    return { code: r.status, out: r.stdout, err: r.stderr, error: r.error?.message };
  }
  function git(args) {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw Error(r.stderr);
    return r.stdout;
  }
  try {
    git(["init", "-q"]);
    symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
    writeFileSync(join(root, ".gitignore"), "node_modules\n");
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(
      join(root, "squeal.config.json"),
      JSON.stringify({
        baseline: { onStart: policy },
        complexity: { enabled: false },
        coverage: { enabled: false },
        slow: { include: ["tiny.test.js"], quietMs: 0, maxParallel: 1, maxWorkers: 1 },
      }),
    );
    writeFileSync(
      join(root, "vitest.config.js"),
      `export default {test:{include:['tiny.test.js'],globalSetup:['./setup.js'],maxWorkers:1}};`,
    );
    writeFileSync(
      join(root, "setup.js"),
      `import {appendFileSync} from 'node:fs';import {spawn} from 'node:child_process';export function setup(){const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});child.unref();appendFileSync(${JSON.stringify(marks)},JSON.stringify({event:'setup',pid:child.pid,token:!!process.env.SQUEAL_DAEMON_CHILD})+'\\n');return ()=>{try{process.kill(child.pid,'SIGTERM')}catch{}appendFileSync(${JSON.stringify(marks)},JSON.stringify({event:'teardown'})+'\\n')}}`,
    );
    writeFileSync(
      join(root, "tiny.test.js"),
      `import {test} from 'vitest';test('tiny',async()=>{await new Promise(r=>setTimeout(r,5000))},10000);`,
    );
    git([
      "add",
      ".gitignore",
      "package.json",
      "squeal.config.json",
      "vitest.config.js",
      "setup.js",
      "tiny.test.js",
    ]);
    git([
      "-c",
      "user.name=probe",
      "-c",
      "user.email=probe@example.invalid",
      "commit",
      "-qm",
      "fixture",
    ]);
    console.log(
      JSON.stringify({
        policy,
        command: "node <checkout>/plugins/claude-code/dist/cli/squeal.mjs start",
        result: run(["start"]),
      }),
    );
    for (let i = 0; i < 30; i++) {
      if (existsSync(marks)) break;
      await delay(250);
    }
    const status = run(["status", "--json"]);
    let parsed;
    try {
      parsed = JSON.parse(status.out);
    } catch {}
    console.log(
      JSON.stringify({
        policy,
        statusCode: status.code,
        status: parsed
          ? {
              revision: parsed.revision,
              daemon: parsed.daemon,
              slowTier: parsed.slowTier,
              testFileCounts: parsed.testFileCounts,
            }
          : status,
        marks: existsSync(marks) ? readFileSync(marks, "utf8") : null,
        gitStatus: git(["status", "--porcelain"]),
      }),
    );
    const start = Date.now();
    const stop = run(["stop", root]);
    stopped = stop.code === 0;
    await delay(300);
    const events = existsSync(marks)
      ? readFileSync(marks, "utf8").trim().split("\n").map(JSON.parse)
      : [];
    console.log(
      JSON.stringify({
        policy,
        command: "node <checkout>/plugins/claude-code/dist/cli/squeal.mjs stop <fixture>",
        stop,
        elapsedMs: Date.now() - start,
        events,
        children: events.filter((e) => e.pid).map((e) => ({ pid: e.pid, alive: alive(e.pid) })),
      }),
    );
  } finally {
    if (!stopped) console.log(JSON.stringify({ cleanupStop: run(["stop", root]) }));
    if (existsSync(marks))
      for (const line of readFileSync(marks, "utf8").trim().split("\n")) {
        const e = JSON.parse(line);
        if (e.pid && alive(e.pid)) {
          process.kill(e.pid, "SIGTERM");
          console.log(JSON.stringify({ fallbackKilled: e.pid }));
        }
      }
    rmSync(root, { recursive: true, force: true });
  }
}
