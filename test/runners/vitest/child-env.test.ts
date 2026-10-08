import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { CHILD_VARIABLE, EscapedChildren } from "../../../src/core/daemon/escaped.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { isAlive } from "../../daemon/strays.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Spec 001 D12 as amended for task 001-142: the daemon's marker reaches
 * every Vitest worker and what a test spawns from it, under both pools, and
 * stays out of the environment hash; after the run, `EscapedChildren` stops
 * what carries it and nothing else. Each invocation has its own random
 * marker, as each daemon does (review wave-13 S1): with one literal, two
 * invocations on one host would stop each other's sleepers.
 */

/** Spawns a detached sleeper with the worker's env, which must carry `marker`, and writes its pid to `sleeper.pid`. */
const leavesSleeper = (marker: string) => `import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
it("sees the marker and leaves a sleeper", () => {
  const seen = spawnSync(process.execPath, ["-e", "process.stdout.write(process.env.${CHILD_VARIABLE} ?? '')"], { encoding: "utf8" });
  expect(seen.stdout).toBe("${marker}");
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000)"], { detached: true, stdio: "ignore" });
  child.unref();
  writeFileSync(new URL("../sleeper.pid", import.meta.url), String(child.pid));
});
`;

const withMarker = (marker: string) => (root: string) =>
  createVitestAdapter({ root, childEnv: { [CHILD_VARIABLE]: marker } });

/** Resolves once `parties` callers wait on it. */
function barrier(parties: number): () => Promise<void> {
  let waiting = 0;
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return () => {
    if (++waiting === parties) open();
    return opened;
  };
}

/**
 * One invocation: its own marker for both pools; each pool's run leaves a
 * sleeper, and after `ready` the sweep must stop that sleeper and nothing else.
 */
async function sweepsOwnSleepers(ready: (pool: string) => Promise<void>): Promise<void> {
  const marker = `marker-${randomUUID()}`;
  const fx = await openFixture(
    "observed",
    { "test/sleeper.test.ts": leavesSleeper(marker) },
    withMarker(marker),
  );
  const children = new EscapedChildren(marker);
  const sleepers: number[] = [];
  for (const pool of ["forks", "threads"]) {
    const since = children.mark();
    const report = await fx.adapter.run([ref("test/sleeper.test.ts", pool)], fx.runOptions());
    expect(report.results.map((r) => r.outcome)).toEqual(["pass"]);
    const pid = Number(readFileSync(join(fx.root, "sleeper.pid"), "utf8"));
    sleepers.push(pid);
    onTestFinished(() => {
      if (isAlive(pid)) process.kill(pid, "SIGKILL");
    });
    expect(isAlive(pid)).toBe(true);
    await ready(pool);
    const note = await children.afterTier(since);
    expect(note).toBe(
      `stopped 1 process a test left running after its tier: ${pid} ${process.execPath} -e setTimeout(() => {}, 600000)`,
    );
    expect(isAlive(pid)).toBe(false);
  }
  expect(new Set(sleepers).size).toBe(2);
}

describe.runIf(process.platform === "linux")(
  "vitest adapter: the daemon's child marker",
  SLOW,
  () => {
    it("reaches both pools' tests and their children; only those are stopped after the run", async () => {
      const bystander = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000)"], {
        detached: true,
        stdio: "ignore",
      });
      onTestFinished(() => {
        bystander.kill("SIGKILL");
      });
      await sweepsOwnSleepers(async () => {});
      expect(bystander.pid !== undefined && isAlive(bystander.pid)).toBe(true);
    });

    it("stops only its own sleepers beside a concurrent invocation (review wave-13 S1)", async () => {
      // Both invocations' sleepers are alive before either sweeps, in each pool.
      const pools = new Map([
        ["forks", barrier(2)],
        ["threads", barrier(2)],
      ]);
      const ready = (pool: string) => pools.get(pool)?.() ?? Promise.resolve();
      await Promise.all([sweepsOwnSleepers(ready), sweepsOwnSleepers(ready)]);
    });

    it("leaves the marker out of the environment hash", async () => {
      // A root project, whose config gets the `env` option.
      const plain = await openFixture("basic");
      const marked = await openFixture("basic", {}, withMarker(`marker-${randomUUID()}`));
      const configs = async (fx: typeof plain) =>
        (await fx.adapter.environment()).map((e) => [e.project, e.resolvedConfig]);
      const relative = (rows: unknown[][], root: string) =>
        JSON.stringify(rows).replaceAll(root, "<root>");
      expect(relative(await configs(marked), marked.root)).toBe(
        relative(await configs(plain), plain.root),
      );
    });
  },
);
