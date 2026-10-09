import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { daemonSuite, SLOW, waitFor, waitReady, withStore } from "./helpers.js";
import { resultOf } from "./scratch-helpers.js";

/*
 * Spec 004 D2, execution (task 004-18), under a real daemon: a slow Vitest
 * file runs in a second Vitest instance of its own, at nice 10, its workers
 * marked with the slow lane; an edit's fast file runs in the first instance
 * and is reported while the slow file is still running. The slow file holds
 * until the test writes its flag.
 */

function slowTest(dir: string): string {
  const at = (name: string) => JSON.stringify(join(dir, name));
  return `import { existsSync, writeFileSync } from "node:fs";
import { getPriority } from "node:os";
import { expect, it } from "vitest";
it("holds until the flag", async () => {
  writeFileSync(${at("started")}, process.env.SQUEAL_DAEMON_CHILD ?? "");
  const deadline = Date.now() + 150_000;
  while (!existsSync(${at("flag")}) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
  }
  // The daemon lowers a slow lane's processes on a 1 s poll (lowerWhile): give a loaded host time.
  const lowered = Date.now() + 20_000;
  while (getPriority() !== 10 && Date.now() < lowered) {
    await new Promise((done) => setTimeout(done, 100));
  }
  writeFileSync(${at("priority")}, String(getPriority()));
  expect(existsSync(${at("flag")})).toBe(true);
}, 190_000);
`;
}

describe.runIf(process.platform === "linux")(
  "squeal daemon: the slow lane (task 004-18)",
  SLOW,
  () => {
    const suite = daemonSuite();

    it("reports an edit's fast file while a slow file runs in its own Vitest instance", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sq-004-18-"));
      suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
      const repo = suite.fixture({
        "test/slow.test.ts": slowTest(dir),
        // The load guard (spec 004 D3) would defer the slow file on this host past the waits.
        "squeal.config.json": `${JSON.stringify({
          slow: { include: ["test/slow.test.ts"], maxLoadPerCpu: 1000 },
        })}\n`,
      });
      const daemon = suite.daemon(repo);
      await waitReady(repo);
      await waitFor(() => existsSync(join(dir, "started")), 150_000, "the slow file started");
      expect(readFileSync(join(dir, "started"), "utf8")).toMatch(/^[^:]+:slow:vitest$/);

      writeFileSync(
        join(repo.root, "src/math.ts"),
        "export const add = (a: number, b: number) => a - b;\n",
      );
      const outcome = (path: string) =>
        withStore(
          repo,
          (store) =>
            store.knownStates
              .list(repo.worktreeId)
              .find((s) => s.check.kind === "test" && s.check.testPath === path)?.outcome,
        );
      await waitFor(() => outcome("test/math.test.ts") === "fail" || null, 120_000, "math fails");
      // The slow file is still running.
      expect(existsSync(join(dir, "priority"))).toBe(false);

      writeFileSync(join(dir, "flag"), "");
      expect((await resultOf(repo, daemon, "test/slow.test.ts")).outcome).toBe("pass");
      expect(readFileSync(join(dir, "priority"), "utf8")).toBe("10");
    });
  },
);
