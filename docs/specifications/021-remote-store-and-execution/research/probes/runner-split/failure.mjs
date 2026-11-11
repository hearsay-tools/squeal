// Throwaway (row 021-04): failure cases of the split, against the container.
// Usage: node failure.mjs drop|hang|noinstall|node2421
//   drop      the SSH client dies 2 s into a 6 s run; what is left on the remote?
//   hang      the container is paused 1 s into a run; does anything but our deadline notice?
//   noinstall the remote tree has no node_modules; what does `open` say?
//   node2421  the host runs on Node v24.21.0 (binary copied from this host); what does it report?
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const scenario = process.argv[2];
const { SSHW, REMOTE_ROOT } = process.env;
const HERE = new URL(".", import.meta.url).pathname;
const MARK = "\u0001SQ ";
const load1 = () => Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
const out = (o) => {
  const line = JSON.stringify({ scenario, load1: load1(), ...o });
  console.log(line);
  appendFileSync(join(HERE, "results", "failure.jsonl"), `${line}\n`);
};
const ps = () =>
  spawnSync("docker", ["exec", "squeal-021-rs", "ps", "-eo", "pid,ppid,etimes,args", "--no-headers"], { encoding: "utf8" })
    .stdout.split("\n")
    .filter((l) => /node|vitest|sshd: root/.test(l) && !/ps -eo/.test(l))
    .map((l) => l.trim().replace(/\s+/g, " ").slice(0, 140));

function connect(root, node = "node") {
  const child = spawn(SSHW, ["remote", `cd /opt/squeal && SQUEAL_SRC=/opt/squeal exec ${node} --import tsx /opt/rs/host.mts ${root}`], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let buf = "";
  let ready;
  const readyP = new Promise((r) => (ready = r));
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.startsWith(MARK)) continue;
      const msg = JSON.parse(line.slice(MARK.length));
      if (msg.ev === "ready") ready();
      else if (msg.id && !msg.ev) pending.get(msg.id)?.(msg);
    }
  });
  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
    for (const p of pending.values()) p({ e: `connection closed (ssh exit ${code ?? signal}) with the request open` });
  });
  let next = 1;
  const call = (m, a = [], deadlineMs = 60_000) =>
    new Promise((resolve) => {
      const id = next++;
      const t = performance.now();
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ error: `deadline ${deadlineMs} ms passed on ${m}`, ms: Math.round(performance.now() - t) });
      }, deadlineMs);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve({ ...(msg.e ? { error: msg.e } : { r: msg.r }), ms: Math.round(performance.now() - t) });
      });
      child.stdin.write(`${JSON.stringify({ id, m, a })}\n`);
    });
  return { child, call, readyP, exited: () => exited };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slow = [{ project: "", path: "test/slow.test.ts" }];

if (scenario === "drop" || scenario === "hang") {
  const h = connect(REMOTE_ROOT);
  await h.readyP;
  await h.call("open");
  const running = h.call("run", [slow, { runId: scenario, timeoutMs: 60_000 }], scenario === "hang" ? 10_000 : 60_000);
  await sleep(scenario === "hang" ? 1000 : 2000);
  out({ step: "during run", remote: ps() });
  if (scenario === "drop") h.child.kill("SIGKILL");
  else spawnSync("docker", ["pause", "squeal-021-rs"]);
  const res = await running;
  out({ step: "driver saw", ...res, sshExited: h.exited() });
  if (scenario === "hang") {
    h.child.kill("SIGKILL");
    await sleep(2000);
    spawnSync("docker", ["unpause", "squeal-021-rs"]);
  }
  await sleep(1500);
  out({ step: "remote 1.5 s later", remote: ps() });
  await sleep(8000);
  out({ step: "remote 9.5 s later", remote: ps() });
} else if (scenario === "noinstall") {
  spawnSync("rsync", ["-a", "--exclude", "node_modules", "--exclude", ".git", "-e", SSHW, `${process.env.FIXTURE}/`, "remote:/work/noinstall/"]);
  const h = connect("/work/noinstall");
  await h.readyP;
  out({ step: "open", ...(await h.call("open")) });
  h.child.kill();
} else if (scenario === "snapshot") {
  // A new snapshot is written by the worker on the remote disk only.
  const { writeFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const F = process.env.FIXTURE;
  writeFileSync(join(F, "test/snap.test.ts"), 'import { expect, test } from "vitest";\ntest("snap", () => { expect({ a: 1 }).toMatchSnapshot(); });\n');
  spawnSync("rsync", ["-a", "--files-from=-", "-e", SSHW, `${F}/`, `remote:${REMOTE_ROOT}/`], { input: "test/snap.test.ts" });
  const h = connect(REMOTE_ROOT);
  await h.readyP;
  await h.call("open", [{ observe: true }]);
  await h.call("invalidate", [[{ path: "test/snap.test.ts", kind: "add" }]]);
  const ref = { project: "", path: "test/snap.test.ts" };
  const run = await h.call("run", [[ref], { runId: "snap", timeoutMs: 60_000 }]);
  const obs = run.r?.observed?.[0] ?? {};
  const paths = [...new Set([...(obs.paths ?? [])])];
  const remoteBlobs = (await h.call("blobs", [paths])).r;
  const local = Object.fromEntries(paths.map((p) => { try { const b = readFileSync(join(F, p)); return [p, createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex")]; } catch { return [p, null]; } }));
  out({ step: "new snapshot on the remote", outcomes: run.r?.results.map((x) => x.outcome), error: run.r?.results[0]?.errors?.[0]?.message?.slice(0, 200), observedPaths: obs.paths, written: obs.written ?? null, differ: paths.filter((p) => remoteBlobs[p] !== local[p]).map((p) => ({ p, local: local[p], remote: remoteBlobs[p] })) });
  await h.call("close");
} else if (scenario === "node2421") {
  const h = connect(REMOTE_ROOT, "/opt/node2421/bin/node");
  await h.readyP;
  const hello = await h.call("hello");
  await h.call("open");
  const env = await h.call("environment");
  const run = await h.call("run", [[{ project: "", path: "test/greet.test.ts" }], { runId: "n", timeoutMs: 60_000 }]);
  out({
    step: "remote on another Node",
    remoteNode: hello.r.node,
    localNode: process.version,
    runnerEnvironmentHoldsNode: JSON.stringify(env.r).includes("24.21"),
    end: run.r?.end,
    outcomes: run.r?.results.map((x) => x.outcome),
    runError: run.error,
    failure: run.r?.failure,
  });
  await h.call("close");
}
process.exit(0);
