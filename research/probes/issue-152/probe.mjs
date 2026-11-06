// Throwaway issue 152 probe. Runs only three isolated fixture files, never the repository suite.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const editLater = process.argv.includes("--edit-later");
const output = resolve(process.argv[2] ?? "research/probes/issue-152/evidence");
mkdirSync(output, { recursive: true });
const cli = "/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.407/dist/cli/squeal.mjs";
const root = mkdtempSync(join(tmpdir(), "sq-152-"));
const runtime = join(root, ".runtime");
mkdirSync(runtime);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/^(VITEST|GIT_|CODEX_|CEZ_)/.test(k) && !["NODE_OPTIONS", "NODE_PATH"].includes(k),
  ),
);
env.XDG_RUNTIME_DIR = runtime;
env.XDG_CONFIG_HOME = join(runtime, "config");
const start = Date.now();
const events = [];
function event(name, data) {
  const e = { ms: Date.now() - start, name, ...data };
  events.push(e);
  console.log(JSON.stringify(e));
  writeFileSync(join(output, "events.json"), `${JSON.stringify(events, null, 2)}\n`);
}
const machine = {
  at: new Date().toISOString(),
  load: loadavg(),
  cpus: cpus().length,
  node: process.version,
  cli,
  root,
};
event("host", machine);
if (machine.load[0] > machine.cpus)
  throw new Error("Load above CPU count: live reproduction skipped");
function sync(exe, args) {
  const r = spawnSync(exe, args, { cwd: root, env, encoding: "utf8", timeout: 10000 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout;
}
function run(args) {
  const p = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", cli, ...args], {
    cwd: root,
    env,
  });
  let stdout = "",
    stderr = "";
  p.stdout.on("data", (d) => (stdout += d));
  p.stderr.on("data", (d) => (stderr += d));
  const done = new Promise((resolve) =>
    p.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr })),
  );
  return { p, done };
}
function store(label) {
  const db = new DatabaseSync(join(root, ".git/squeal/store.sqlite"), { readOnly: true });
  const data = {
    at: new Date().toISOString(),
    keys: db.prepare("select * from test_file_keys").all(),
    results: db
      .prepare(
        "select c.test_path,r.key,r.outcome,r.revision,r.run_id,r.recorded_at from results r join checks c on c.id=r.check_id",
      )
      .all(),
    runs: db.prepare("select * from runs").all(),
  };
  db.close();
  writeFileSync(join(output, `store-${label}.json`), `${JSON.stringify(data, null, 2)}\n`);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
writeFileSync(
  join(root, "package.json"),
  JSON.stringify({
    name: "issue-152-probe",
    private: true,
    type: "module",
    devDependencies: { vitest: "5.0.3" },
  }),
);
symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
writeFileSync(join(root, ".gitignore"), "node_modules/\n.runtime/\n");
writeFileSync(
  join(root, "vitest.config.ts"),
  `export default {test:{include:['*.test.ts'],maxWorkers:2,testTimeout:40000}};\n`,
);
writeFileSync(
  join(root, "squeal.config.json"),
  JSON.stringify({
    baseline: { onStart: "lookup-only" },
    runner: { tierSize: 2, backlogTierSize: 4, timeoutMs: 60000 },
    coverage: { enabled: false },
    complexity: { enabled: false },
  }),
);
for (const [name, ms] of [
  ["fast", 50],
  ["slow", 20000],
  ["later", 50],
])
  writeFileSync(
    join(root, `${name}.test.ts`),
    `import {it,expect} from 'vitest';\nit('${name}',async()=>{await new Promise(r=>setTimeout(r,${ms}));expect(1).toBe(1)});\n`,
  );
sync("git", ["init", "-q"]);
sync("git", [
  "add",
  "package.json",
  ".gitignore",
  "vitest.config.ts",
  "squeal.config.json",
  "fast.test.ts",
  "slow.test.ts",
  "later.test.ts",
]);
sync("git", [
  "-c",
  "user.name=Research probe",
  "-c",
  "user.email=probe@example.invalid",
  "commit",
  "-qm",
  "fixture",
]);
event("version", {
  version: sync(process.execPath, [cli, "--version"]).trim(),
  vitest: JSON.parse(readFileSync(join(root, "node_modules/vitest/package.json"), "utf8")).version,
});
const daemon = run(["daemon", root]);
async function status(label, paths = []) {
  const r = await run(["status", "--json", ...paths]).done;
  writeFileSync(join(output, `${label}.json`), r.stdout);
  if (r.stderr) writeFileSync(join(output, `${label}.stderr`), r.stderr);
  let value;
  try {
    value = JSON.parse(r.stdout);
  } catch {}
  return { r, value };
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await pause(500);
    const s = await status("startup");
    if (
      s.value?.testFileCounts &&
      Object.values(s.value.testFileCounts).reduce((a, b) => a + b, 0) >= 3
    ) {
      ready = true;
      break;
    }
  }
  if (!ready) throw new Error("Fixture discovery not ready in 30s");
  event("listed");
  const broad = run(["status", "--wait", "60000", "--json", "fast.test.ts", "slow.test.ts"]);
  let mid;
  for (let i = 0; i < 80; i++) {
    await pause(250);
    const s = await status("mid-batch", ["fast.test.ts", "slow.test.ts"]);
    if (
      JSON.stringify(s.value).includes("endedFiles") ||
      JSON.stringify(s.value).includes('"ended":1')
    ) {
      mid = s;
      break;
    }
  }
  event("mid-batch", { observed: !!mid });
  store("mid");
  const narrow = await run(["status", "--wait", "1500", "--json", "fast.test.ts"]).done;
  writeFileSync(join(output, "fast-wait.json"), narrow.stdout);
  event("fast-wait", { code: narrow.code });
  if (editLater) {
    writeFileSync(
      join(root, "later.test.ts"),
      `${readFileSync(join(root, "later.test.ts"), "utf8")}// edited during named batch\n`,
    );
    event("edit-later");
  }
  const later = await run([
    "status",
    "--wait",
    editLater ? "10000" : "1500",
    "--json",
    "later.test.ts",
  ]).done;
  writeFileSync(join(output, "later-wait.json"), later.stdout);
  event("later-wait", { code: later.code });
  const text = await run(["status", "fast.test.ts", "later.test.ts"]).done;
  writeFileSync(join(output, "mid-batch.txt"), text.stdout);
  store("before-end");
  await status("before-end", ["fast.test.ts", "slow.test.ts", "later.test.ts"]);
  const result = await broad.done;
  writeFileSync(join(output, "broad-wait.json"), result.stdout);
  event("broad-wait", { code: result.code });
  const final = await run([
    "status",
    "--wait",
    "20000",
    "--json",
    "fast.test.ts",
    "slow.test.ts",
    "later.test.ts",
  ]).done;
  writeFileSync(join(output, "final.json"), final.stdout);
  event("final", { code: final.code });
  store("final");
} finally {
  const stopped = await run(["stop", root]).done;
  event("stop", { code: stopped.code });
  const ended = await Promise.race([daemon.done, pause(10000).then(() => null)]);
  if (!ended) {
    daemon.p.kill("SIGTERM");
    event("daemon-forced-stop");
  } else {
    writeFileSync(join(output, "daemon.log"), ended.stdout + ended.stderr);
    event("daemon-exit", { code: ended.code });
  }
}
