import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Vitest } from "vitest/node";
import { VitestAdapter } from "../../../src/runners/vitest/adapter.js";
import { CRASH_CLOSE_MS, retireCrashed } from "../../../src/runners/vitest/broken.js";
import { loadVitest, type VitestNode } from "../../../src/runners/vitest/load.js";
import { WorktreePaths } from "../../../src/runners/vitest/paths.js";
import { RunCollector } from "../../../src/runners/vitest/reporter.js";
import { waitFor } from "../../watcher/helpers.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Row 011-289 (`research/ci-crash-rekey-stall.md`, its probe): a worker that
 * dies while Vitest 5.0.3's cancel waits for it leaves that cancel pending,
 * and the instance's next run waits for it before it starts a worker.
 */

const FIXED = 'import { it } from "vitest";\nit("survives", () => {});\n';

/** Rewrites itself, then sleeps, answering no graceful cancel, until the release; then dies. */
const KILLING = `import { existsSync, writeFileSync } from "node:fs";
import { it } from "vitest";
it("rewrites itself, then dies once the run's cancel began", () => {
  writeFileSync(new URL(import.meta.url), ${JSON.stringify(FIXED)});
  writeFileSync(new URL("../kill.pid", import.meta.url), String(process.pid));
  const release = new URL("../kill.release", import.meta.url);
  for (const until = Date.now() + 60_000; !existsSync(release) && Date.now() < until; )
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  process.kill(process.pid, "SIGKILL");
});
`;

/**
 * `vitest/node` of `root`: each instance it creates is in `created`, and its
 * cancel writes the release once begun, when Vitest has taken the running
 * task to cancel.
 */
async function releasing(root: string, created: Vitest[]): Promise<VitestNode> {
  const real = await loadVitest(root);
  return {
    ...real,
    createVitest: async (...args: Parameters<VitestNode["createVitest"]>) => {
      const vitest = await real.createVitest(...args);
      const cancel = vitest.cancelCurrentRun.bind(vitest);
      vitest.cancelCurrentRun = (reason) => {
        const cancelling = cancel(reason);
        writeFileSync(join(root, "kill.release"), "go");
        return cancelling;
      };
      created.push(vitest);
      return vitest;
    },
  } as VitestNode;
}

describe("vitest adapter: a worker that dies during the run's cancel (row 011-289)", SLOW, () => {
  it("closes the instance after the crash; the next run gets a new one and completes", async () => {
    const created: Vitest[] = [];
    const p = await openFixture("basic", { "test/kill.test.ts": KILLING }, async (root) => {
      const real = realpathSync(root);
      const adapter = new VitestAdapter(new WorktreePaths(real), await releasing(real, created));
      await adapter.open();
      return adapter;
    });
    const kill = ref("test/kill.test.ts");
    const abort = new AbortController();
    const firstLogs = join(p.root, ".squeal-logs/first");
    const first = p.adapter.run(
      [kill],
      p.runOptions({ logDir: firstLogs, timeoutMs: 30_000, signal: abort.signal }),
    );
    await waitFor(() => existsSync(join(p.root, "kill.pid")), 30_000);
    abort.abort("supersession");
    const crashed = await first;

    expect(crashed).toMatchObject({ end: "crashed", completedFiles: [], results: [] });
    expect(crashed.failure).toContain("run cancelled: the revisions during it changed");
    expect(crashed.failure).toContain("Worker forks emitted error");
    expect(readFileSync(join(firstLogs, "vitest.log"), "utf8")).toContain(
      "the instance is closed; the next run starts a new one",
    );
    expect(p.read("test/kill.test.ts")).toBe(FIXED);

    await p.adapter.invalidate([{ path: kill.path, kind: "change" }]);
    const again = await p.adapter.run([kill], p.runOptions({ timeoutMs: 30_000 }));
    expect(again).toMatchObject({ end: "completed", failure: null, completedFiles: [kill] });
    expect(created).toHaveLength(2);
  });

  it("leaves a crashed instance whose close does not settle once its bound runs out", async () => {
    vi.useFakeTimers();
    try {
      const collector = new RunCollector([], new WorktreePaths("/work/tree"));
      const unsettled = { close: () => new Promise<void>(() => {}) } as unknown as Vitest;
      let returned = false;
      const retiring = retireCrashed(unsettled, collector).then(() => {
        returned = true;
      });
      await vi.advanceTimersByTimeAsync(CRASH_CLOSE_MS - 1);
      expect(returned).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await retiring;
      expect(collector.log.join("\n")).toContain(
        `close() of the crashed instance did not settle within ${CRASH_CLOSE_MS} ms`,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
