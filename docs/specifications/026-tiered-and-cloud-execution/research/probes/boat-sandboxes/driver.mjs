// Throwaway (026 boat-sandboxes). Drives `squeal runner-host` on a sandbox over one kept
// ssh connection, with the protocol of spec 021 D6 (src/core/runner-host/protocol.ts), and
// times edit to verdict the way a remote lane would do it: the edit rides on `invalidate`
// (tree write), then `affected`, `closure`, the blob proof (`expected`) and `run`.
//
//   node driver.mjs vitest  <local repo> <remote root> <ssh args json> [coverage]
//   node driver.mjs nodetest <remote fixture root> <ssh args json>
//
// It reads the local repo only to take the edited files' bytes (same commit as the remote).
// Each line it prints is one JSON record; nothing is written locally.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const MARKER = "\u0001squeal-runner-host ";
const [mode, ...rest] = process.argv.slice(2);
const ms = (t) => Math.round(Number(process.hrtime.bigint() - t) / 1e5) / 10;
const now = () => process.hrtime.bigint();
const blob = (bytes) =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

function host(sshArgs, command) {
  const child = spawn("ssh", [...sshArgs, command], { stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  let next = 1;
  const waiting = new Map();
  const events = [];
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      const i = line.indexOf(MARKER);
      if (i < 0) continue;
      const text = line.slice(i + MARKER.length);
      const msg = JSON.parse(text);
      if ("id" in msg && waiting.has(msg.id)) {
        const { resolve, reject } = waiting.get(msg.id);
        waiting.delete(msg.id);
        if ("e" in msg) reject(new Error(msg.e.message));
        else resolve({ r: msg.r, bytes: text.length });
      } else events.push({ ...msg, bytes: text.length });
    }
  });
  let err = "";
  child.stderr.on("data", (c) => {
    err += c.toString();
    if (err.length > 20000) err = err.slice(-10000);
  });
  const request = (m, a) =>
    new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      child.stdin.write(`${MARKER}${JSON.stringify({ id, m, a })}\n`);
    });
  const close = async () => {
    await request("close", []).catch(() => {});
    child.stdin.end();
  };
  return { request, events, close, stderr: () => err };
}

function treeWrite(files) {
  const entries = files.map(({ path, bytes }) => ({ path, blob: blob(bytes), size: bytes.length }));
  const gzip = files.length === 0 ? "" : gzipSync(Buffer.concat(files.map((f) => f.bytes))).toString("base64");
  return { files: entries, gzip, removed: [] };
}

async function vitest([local, root, sshJson, cov]) {
  const sshArgs = JSON.parse(sshJson);
  const coverage = cov === "coverage";
  const policy = {
    observe: true, exclude: [], excludeProjects: [], coverage, coverageChildren: false,
  };
  const h = host(
    sshArgs,
    `cd ${root} && exec node plugins/claude-code/dist/cli/squeal.mjs runner-host ${root} --runner vitest --tree`,
  );
  let t = now();
  const started = await h.request("start", [{
    protocol: 1, version: "0.1.611", runner: "vitest",
    options: {
      childEnv: {}, maxWorkers: 4,
      ...(coverage ? { coverage: { provider: `${root}/plugins/claude-code/dist/coverage/provider.mjs`, tempDir: "/tmp/sq026-cov" } } : {}),
    },
    policy,
  }]);
  console.log(JSON.stringify({ step: "start", ms: ms(t), host: started.r.host }));
  t = now();
  const files = (await h.request("testFiles", [])).r;
  console.log(JSON.stringify({ step: "testFiles", ms: ms(t), count: files.length }));
  const project = files[0].project;
  const capacity = files.filter((f) => f.path.startsWith("test/capacity/")).map((f) => f.path).sort().slice(0, 10);
  const original = new Map();
  const blobCache = new Map();
  const localBlob = (path) => {
    if (!blobCache.has(path)) {
      try { blobCache.set(path, blob(readFileSync(`${local}/${path}`))); } catch { blobCache.set(path, null); }
    }
    return blobCache.get(path);
  };
  let n = 0;
  const edit = async (label, paths, runDirectOnly = true) => {
    n++;
    const changed = paths.map((path) => {
      if (!original.has(path)) original.set(path, readFileSync(`${local}/${path}`));
      const bytes = Buffer.concat([original.get(path), Buffer.from(`\n// sq026 edit ${n}\n`)]);
      blobCache.set(path, blob(bytes));
      return { path, bytes };
    });
    const t0 = now();
    const write = treeWrite(changed);
    let t = now();
    await h.request("invalidate", [paths.map((path) => ({ path, kind: "change" })), write]);
    const tInv = ms(t);
    t = now();
    const affected = (await h.request("affected", [paths])).r;
    const tAff = ms(t);
    const run = runDirectOnly ? affected.direct : [...affected.direct, ...(affected.transitive)];
    t = now();
    const closures = await Promise.all(run.map((f) => h.request("closure", [f]).then((x) => x.r)));
    const tClo = ms(t);
    const expected = {};
    for (const c of closures) for (const p of c.paths) expected[p] = localBlob(p);
    const before = h.events.length;
    t = now();
    const reply = await h.request("run", [run, {
      runId: `sq026-${n}`, logDir: "/tmp/sq026-logs", timeoutMs: 120000, expected, alive: 5000,
    }]);
    const tRun = ms(t);
    const total = ms(t0);
    const r = reply.r;
    const cov = h.events.slice(before).filter((e) => e.ev === "coverage");
    const results = r.results ?? [];
    console.log(JSON.stringify({
      step: label, files: run.length, expectedPaths: Object.keys(expected).length,
      gzipBytes: write.gzip.length, invalidateMs: tInv, affectedMs: tAff, closureMs: tClo,
      runMs: tRun, vitestMs: r.durationMs, totalMs: total,
      refused: r.refused?.length ?? 0, proofPaths: r.proof ? Object.keys(r.proof).length : 0,
      pass: results.filter((x) => x.outcome === "pass").length,
      fail: results.filter((x) => x.outcome === "fail").length,
      replyBytes: reply.bytes, coverageEvents: cov.length,
      coverageBytes: cov.reduce((s, e) => s + e.bytes, 0),
      coverageFiles: cov.reduce((s, e) => s + (e.run?.files?.length ?? 0), 0),
    }));
  };
  // Warm: one run of one file, untimed as an edit.
  await edit("warm", [capacity[0]]);
  for (let i = 0; i < 5; i++) await edit("edit-1", [capacity[0]]);
  for (let i = 0; i < 3; i++) await edit("edit-10", capacity);
  // A source edit: the run covers the test files that import it directly.
  for (let i = 0; i < 2; i++) await edit("edit-src", ["src/core/capacity/quiet-demand.ts"]);
  // Put the edited files back, so the root holds the commit again.
  await h.request("invalidate", [[...original.keys()].map((path) => ({ path, kind: "change" })),
    treeWrite([...original].map(([path, bytes]) => ({ path, bytes })))]);
  await h.close();
  console.log(JSON.stringify({ step: "project", project }));
}

async function nodetest([root, sshJson]) {
  const sshArgs = JSON.parse(sshJson);
  const h = host(
    sshArgs,
    `cd ${root} && exec node ~/squeal/plugins/claude-code/dist/cli/squeal.mjs runner-host ${root} --runner node-test`,
  );
  let t = now();
  const project = { name: "spawn", argv: ["--test"], env: {}, include: ["test/**/*.test.mjs"] };
  await h.request("start", [{
    protocol: 1, version: "0.1.611", runner: "node-test",
    options: { childEnv: {}, process: { project, tempDir: "/tmp" } },
    policy: { observe: true, exclude: [], excludeProjects: [], coverage: false, coverageChildren: false, tierSize: 4 },
  }]);
  console.log(JSON.stringify({ step: "start", ms: ms(t) }));
  const files = (await h.request("testFiles", [])).r;
  console.log(JSON.stringify({ step: "testFiles", files }));
  for (let i = 0; i < 4; i++) {
    t = now();
    await h.request("invalidate", [[{ path: files[0].path, kind: "touch" }]]);
    const r = (await h.request("run", [[files[0]], { runId: `nt-${i}`, logDir: "/tmp/sq026-nt", timeoutMs: 60000 }])).r;
    console.log(JSON.stringify({ step: "node-test-1", ms: ms(t), durationMs: r.durationMs, results: (r.results ?? []).map((x) => x.outcome) }));
  }
  await h.close();
}

const main = { vitest, nodetest }[mode];
if (!main) {
  console.error("usage: driver.mjs vitest|nodetest ...");
  process.exit(2);
}
main(rest).then(() => process.exit(0), (e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
