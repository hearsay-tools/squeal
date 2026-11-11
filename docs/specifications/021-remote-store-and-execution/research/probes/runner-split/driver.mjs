// Throwaway (row 021-04): the local driver. It plays the daemon's side of the split:
// it edits the local fixture, syncs the changed path, drives host.mts over stdio
// (through SSH for `remote`, a plain child for `local`), proves the remote tree with
// git blob ids before and after the run, and prints one JSON line per step.
// Usage: node driver.mjs local|remote [edits=5] [--observe]
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [mode = "remote", editsArg = "5"] = process.argv.slice(2);
const observe = process.argv.includes("--observe");
const fail = process.argv.includes("--fail");
const { FIXTURE, SQUEAL_SRC, SSHW, REMOTE_ROOT } = process.env;
const HERE = new URL(".", import.meta.url).pathname;
const remote = mode === "remote";
const MARK = "\u0001SQ ";

const child = remote
  ? spawn(SSHW, ["remote", `cd /opt/squeal && SQUEAL_SRC=/opt/squeal exec node --import tsx /opt/rs/host.mts ${REMOTE_ROOT}`], {
      stdio: ["pipe", "pipe", "pipe"],
    })
  : spawn(process.execPath, ["--import", "tsx", join(HERE, "host.mts"), FIXTURE], {
      cwd: SQUEAL_SRC,
      env: { ...process.env, SQUEAL_SRC },
      stdio: ["pipe", "pipe", "pipe"],
    });
let stderr = "";
child.stderr.on("data", (d) => (stderr += d));
const pending = new Map();
const events = [];
let ready;
const readyP = new Promise((r) => (ready = r));
let buf = "";
let bytesIn = 0;
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.startsWith(MARK)) continue;
    bytesIn += Buffer.byteLength(line) + 1;
    const msg = JSON.parse(line.slice(MARK.length));
    if (msg.ev === "ready") ready(msg);
    else if (msg.ev) events.push({ ...msg, at: performance.now() });
    else {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      p.resolve({ ...msg, bytes: Buffer.byteLength(line) + 1 });
    }
  }
});
child.on("exit", (code, signal) => {
  for (const p of pending.values()) p.reject(new Error(`host exited (${code ?? signal}) with a request open`));
  pending.clear();
});
let next = 1;
/** One request, one round trip. Rejects at `deadlineMs`. */
function call(m, a = [], deadlineMs = 120_000) {
  const id = next++;
  const t = performance.now();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`deadline ${deadlineMs} ms passed on ${m}`));
    }, deadlineMs);
    pending.set(id, {
      resolve: (msg) => {
        clearTimeout(timer);
        if (msg.e) reject(new Error(msg.e));
        else resolve({ r: msg.r, ms: performance.now() - t, bytes: msg.bytes });
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    child.stdin.write(`${JSON.stringify({ id, m, a })}\n`);
  });
}
const out = (o) => {
  const line = JSON.stringify({ mode, load1: Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]), ...o });
  console.log(line);
  appendFileSync(join(HERE, "results", `driver-${mode}.jsonl`), `${line}\n`);
};
const ms = (x) => Math.round(x * 10) / 10;
const localBlob = (rel) => {
  try {
    const b = readFileSync(join(FIXTURE, rel));
    return createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
  } catch {
    return null;
  }
};
function sync(paths) {
  if (!remote) return 0;
  const t = performance.now();
  const r = spawnSync("rsync", ["-a", "--files-from=-", "-e", SSHW, `${FIXTURE}/`, `remote:${REMOTE_ROOT}/`], {
    input: paths.join("\n"),
  });
  if (r.status !== 0) throw new Error(`rsync: ${r.stderr}`);
  return performance.now() - t;
}
/** The proof: the remote's blob ids of `paths` against the local ones the key was computed from. */
async function prove(paths, expected) {
  const { r, ms: t } = await call("blobs", [paths]);
  const differ = paths.filter((p) => r[p] !== expected[p]);
  return { ms: ms(t), checked: paths.length, differ };
}

const t0 = performance.now();
const hello0 = await readyP;
const spawnMs = performance.now() - t0;
const hello = await call("hello");
const opened = await call("open", [{ observe }]);
out({ step: "start", spawnMs: ms(spawnMs), openMs: ms(opened.ms), openInHostMs: opened.r.ms, hello: hello.r, pid: hello0.pid });
const files = await call("testFiles");
const env = await call("environment");
out({ step: "list", testFiles: files.r.length, listMs: ms(files.ms), envMs: ms(env.ms), envBytes: env.bytes, environment: env.r });

const fast = files.r.filter((f) => !f.path.includes("slow"));
const cold = await call("run", [fast, { runId: "cold", timeoutMs: 60_000 }]);
out({ step: "cold-run", ms: ms(cold.ms), bytes: cold.bytes, end: cold.r.end, completed: cold.r.completedFiles.length, results: cold.r.results.map((x) => `${x.check.name ?? JSON.stringify(x.check)}:${x.outcome}`) });

for (let n = 1; n <= Number(editsArg); n++) {
  const path = "src/math.ts";
  appendFileSync(join(FIXTURE, path), `// edit ${n} ${Date.now()}\n`);
  // --fail: the first edit breaks `add`, so the run reports failures whose text and location we keep.
  if (fail && n === 1) appendFileSync(join(FIXTURE, path), "export const sub = (a: number) => { throw new Error(`broken at ${a}`); };\n");
  const step = { step: "edit", n };
  step.syncMs = ms(sync([path]));
  const inv = await call("invalidate", [[{ path, kind: "change" }]]);
  step.invalidateMs = ms(inv.ms);
  const aff = await call("affected", [[path]]);
  step.affectedMs = ms(aff.ms);
  const tests = [...aff.r.direct, ...aff.r.transitive];
  step.affected = tests.map((t) => t.path);
  const closures = [];
  let closureMs = 0;
  for (const t of tests) {
    const c = await call("closure", [t]);
    closureMs += c.ms;
    closures.push(c.r);
  }
  step.closureMs = ms(closureMs);
  step.closureBytes = closures.reduce((s, c) => s + JSON.stringify(c).length, 0);
  const inputs = [...new Set([...closures.flatMap((c) => c.paths), ...env.r.flatMap((e) => e.files)])].sort();
  const expected = Object.fromEntries(inputs.map((p) => [p, localBlob(p)]));
  const before = await prove(inputs, expected);
  step.proofBeforeMs = before.ms;
  step.proofPaths = before.checked;
  step.proofBeforeDiffer = before.differ;
  const run = await call("run", [tests, { runId: `edit-${n}`, timeoutMs: 60_000 }]);
  step.runMs = ms(run.ms);
  step.runBytes = run.bytes;
  step.end = run.r.end;
  step.completed = run.r.completedFiles.map((f) => f.path);
  step.outcomes = run.r.results.map((x) => x.outcome);
  if (fail) step.errors = [...run.r.results.flatMap((x) => x.errors), ...run.r.fileErrors.flatMap((f) => f.errors)].map((e) => ({ message: e.message, location: e.location, stack: e.stack?.slice(0, 400) }));
  step.observed = run.r.observed?.map((o) => ({ testFile: o.testFile.path, paths: o.paths })) ?? null;
  // After the run: the closure, plus every path the run was observed to read (it joins the key).
  const read = [...new Set([...inputs, ...(run.r.observed ?? []).flatMap((o) => o.paths)])].sort();
  for (const p of read) if (!(p in expected)) expected[p] = localBlob(p);
  const after = await prove(read, expected);
  step.proofAfterPaths = after.checked;
  step.proofAfterMs = after.ms;
  step.proofAfterDiffer = after.differ;
  step.roundTrips = 4 + tests.length + (remote ? 2 : 0);
  step.totalMs = ms(
    step.syncMs + step.invalidateMs + step.affectedMs + step.closureMs + step.proofBeforeMs + step.runMs + step.proofAfterMs,
  );
  out(step);
}
// A mixed tree: the local file moves after the sync, so the remote proof must refuse it.
appendFileSync(join(FIXTURE, "src/math.ts"), "// not synced\n");
const stale = await prove(["src/math.ts"], { "src/math.ts": localBlob("src/math.ts") });
out({ step: "unsynced-edit-proof", differ: stale.differ });
sync(["src/math.ts"]);

await call("close").catch(() => {});
out({ step: "end", bytesIn, events: events.length, stderrTail: stderr.slice(-400) });
process.exit(0);
