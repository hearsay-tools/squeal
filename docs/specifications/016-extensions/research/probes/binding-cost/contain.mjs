// Throwaway probe for 016-34, question 4: does a provider that throws,
// blocks or never settles stall the host's timers? No argument: runs every
// binding x fault case, each in a fresh host process, and prints one JSON
// line per case. With a JSON argument: runs one case as that host.
// The host keeps a 50 ms heartbeat and a 1000 ms guard on run(); on the
// guard it kills the provider where the binding can, then opens a fresh,
// fault-free binding and runs once. "block" sleeps in Atomics.wait for
// BLOCK_MS: the thread is held, no CPU is burnt. Runs in the agreed turn.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { open } from "./bindings.mjs";

const B = "/tmp/bc34";
const SELF = fileURLToPath(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.argv[2] === undefined) {
  mkdirSync(`${B}/tmp/contain`, { recursive: true });
  for (const binding of ["inproc", "worker", "rpc", "command"])
    for (const fault of ["throw", "throw-async", "block", "hang"]) {
      const r = spawnSync("nice", ["-n", "10", process.execPath, SELF, JSON.stringify({ binding, fault })], {
        encoding: "utf8",
        timeout: 20_000,
        env: { PATH: process.env.PATH, HOME: `${B}/home`, XDG_RUNTIME_DIR: `${B}/run`, XDG_CONFIG_HOME: `${B}/config`, TMPDIR: `${B}/tmp/contain` },
      });
      const line = r.stdout.trim().split("\n").filter(Boolean).pop();
      if (r.status === 0 && line !== undefined) console.log(line);
      else
        console.log(
          JSON.stringify({
            binding,
            fault,
            hostExit: r.status ?? r.signal,
            hostStderr: r.stderr.split("\n").find((l) => /Error/.test(l)) ?? r.stderr.slice(0, 200),
          }),
        );
    }
} else {
  const { binding: kind, fault } = JSON.parse(process.argv[2]);
  const options = { root: `${B}/tools/work`, check: "trivial", eslintDir: `${B}/tools` };
  let last = performance.now();
  let maxGapMs = 0;
  const beat = setInterval(() => {
    const now = performance.now();
    maxGapMs = Math.max(maxGapMs, now - last);
    last = now;
  }, 50);
  const t0 = performance.now();
  const binding = await open(kind, { ...options, fault });
  const result = binding.run(["checks/a.check.js"]).then(
    () => "resolved",
    (e) => `rejected: ${e.message}`,
  );
  const guard = sleep(1000).then(() => ({ guardFiredAtMs: Math.round(performance.now() - t0) }));
  const first = await Promise.race([result, guard]);
  const outcome = typeof first === "string" ? first : "guard fired";
  const killed = typeof first === "string" ? null : binding.kill();
  const afterKill = typeof first === "string" ? null : await Promise.race([result, sleep(500).then(() => "still pending")]);
  const fresh = await open(kind, options);
  const recovered = await fresh.run(["checks/a.check.js"]).then(
    (r) => r.results[0].outcome === "pass",
    (e) => `fresh run failed: ${e.message}`,
  );
  await fresh.close();
  while (performance.now() - t0 < 4000) await sleep(50);
  clearInterval(beat);
  console.log(
    JSON.stringify({
      binding: kind,
      fault,
      outcome,
      guardFiredAtMs: typeof first === "string" ? null : first.guardFiredAtMs,
      killed,
      afterKill,
      recovered,
      maxHeartbeatGapMs: Math.round(maxGapMs),
    }),
  );
  if (kind !== "inproc") await binding.close().catch(() => {});
  process.exit(0);
}
