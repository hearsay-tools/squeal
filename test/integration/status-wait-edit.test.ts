import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { requestDaemon } from "../../src/core/daemon/client.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { FILES, settled, statusWhen, waitDaemons } from "./wait-daemon.js";

/*
 * Lessons, defect 32, under a real daemon run from the sources: a wait after
 * an edit that changes no outcome ran until nothing was pending anywhere
 * (99.6 s and 577.9 s at the end of a slow file, while the edited file's
 * result came in 1 to 10 s). Task 001-186: it ends once the files the edit
 * re-keyed have their results. Here `squeal run --slow` runs a slow file for
 * 30 s in its own lane (spec 004 D2), and a neutral edit to `src/mod.ts`
 * follows: its wait must end long before the slow file does.
 *
 * Not here: a backlog of fast files. After an environment change the edited
 * file shares the backlog's tier, and in probes of this fixture the edit did
 * not cut that tier short, so the file's own result came only at the
 * backlog's end (the same at 0.1.76); the CLI tests hold the wait to the
 * file's result (`test/cli/status-wait-edit.test.ts`).
 */

const { createRepo, startDaemon } = waitDaemons("wait-edit");
const SLOW = { timeout: 600_000 } as const;
const SLOW_FILE_MS = 30_000;

const POLICY = { slow: { include: ["test/slow.test.ts"], maxLoadPerCpu: 1_000 } };
/** The baseline runs it at once; an edit makes it take `SLOW_FILE_MS` before `run --slow`. */
const slowTest = (ms: number) => `import { expect, it } from "vitest";
it("takes its time", async () => {
  await new Promise((done) => setTimeout(done, ${ms}));
  expect(true).toBe(true);
}, 300_000);
`;

describe("status --wait ends when the edit's own files are done (defect 32)", () => {
  it(
    "returns within seconds of the edited file's result while a slow file runs",
    SLOW,
    async () => {
      const root = createRepo("slow", {
        ...FILES,
        "squeal.config.json": `${JSON.stringify(POLICY)}\n`,
        "test/slow.test.ts": slowTest(0),
      });
      const socket = await startDaemon(root);
      const before = (await settled(root)).revision;
      writeFileSync(join(root, "test/slow.test.ts"), slowTest(SLOW_FILE_MS));
      await statusWhen(root, "the slow file's edit", (s) => s.revision > before);

      await requestDaemon(socket, { type: "run-slow" }, 10_000);
      const pending = (s: StatusSnapshot) => s.counts.pending + s.testFilesWithoutChecks.pending;
      await statusWhen(root, "the slow file to run", (s) => pending(s) > 0);

      appendFileSync(join(root, "src/mod.ts"), "// neutral\n");
      const wait = await waitForStatus(root, { timeoutMs: 120_000 });

      expect(wait.outcome).toBe("quiet");
      expect(wait).toMatchObject({ edit: { testFiles: 1, pending: 0 } });
      expect(wait.waitedMs).toBeLessThan(SLOW_FILE_MS / 2);
      // The slow file still runs: the wait did not wait for it.
      expect(wait.result.available && pending(wait.result)).toBeGreaterThan(0);

      // An environment edit re-keys every file: the wait holds for the fast one and names both.
      appendFileSync(join(root, "vitest.config.ts"), "// environment\n");
      const env = await waitForStatus(root, { timeoutMs: 120_000 });

      expect(env.outcome).toBe("quiet");
      expect(env).toMatchObject({ edit: { testFiles: 2, pending: 0 } });
    },
  );
});
