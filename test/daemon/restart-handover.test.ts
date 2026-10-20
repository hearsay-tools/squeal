import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { daemonSuite, delay, SLOW, spawnCli, waitFor, withStore } from "./helpers.js";

/*
 * Task 011-33 (row 011-30 R3, gh-47), spec 011 C4 "Explicit checkpoints" as
 * amended 2026-10-20: a daemon's start queues again what its predecessor
 * left queued or running, whatever `baseline.onStart` says. Run 5 of
 * `research/issue-47.md`'s probe, same version, `lookup-only`: `stop` with
 * the edit's tier held, then `start`, left the edited file stale with
 * nothing queued, and `status --wait` on it returned on quiet in 0.5 s.
 */

const suite = daemonSuite();
const HOLD = "test/hold.test.ts";

/** Appends to `started` on each run, then sleeps while `hold` exists. */
function heldTest(dir: string): string {
  const at = (name: string) => JSON.stringify(join(dir, name));
  return `import { appendFileSync, existsSync } from "node:fs";
import { expect, it } from "vitest";
it("holds while the flag exists", async () => {
  appendFileSync(${at("started")}, "x");
  const deadline = Date.now() + 150_000;
  while (existsSync(${at("hold")}) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
  }
  expect(existsSync(${at("hold")})).toBe(false);
}, 170_000);
`;
}

describe.runIf(process.platform === "linux")(
  "a restart hands the queued work over (task 011-33)",
  SLOW,
  () => {
    it("under lookup-only, a stop with the edit's tier held and a start: the named wait holds until its result", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sq-011-33-"));
      const flag = join(dir, "hold");
      suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
      const repo = suite.fixture({
        "squeal.config.json": `${JSON.stringify({ baseline: { onStart: "lookup-only" } })}\n`,
        [HOLD]: heldTest(dir),
      });
      const squeal = (...args: string[]) =>
        spawnCli(suite.cli, args, { cwd: repo.root, env: repo.env });
      const starts = () => {
        const path = join(dir, "started");
        return existsSync(path) ? readFileSync(path, "utf8").length : 0;
      };

      expect(await squeal("start").exited).toEqual({ code: 0, signal: null });
      expect((await squeal("run", "--all", "--wait").exited).code).toBe(0);
      expect(starts()).toBe(1);
      // The hold on, then the edit: its tier holds the file (run 5).
      writeFileSync(flag, "");
      appendFileSync(join(repo.root, HOLD), "// edit\n");
      await waitFor(() => starts() >= 2, 120_000, "the edited file running, held");
      expect(await squeal("stop").exited).toEqual({ code: 0, signal: null });
      expect(await squeal("start").exited).toEqual({ code: 0, signal: null });

      const wait = squeal("status", "--wait", "60000", HOLD);
      const early = await Promise.race([
        wait.exited.then(() => "returned"),
        delay(5_000).then(() => "held"),
      ]);
      expect(early, wait.stdout()).toBe("held");
      // The successor runs the handed-over file: it is held again.
      await waitFor(() => starts() >= 3, 60_000, "the successor running the held file");
      rmSync(flag);
      const released = performance.now();
      expect((await wait.exited).code, wait.stdout()).toBe(0);
      console.log(
        `011-33: the wait returned ${Math.round(performance.now() - released)} ms after the release`,
      );
      expect(wait.stdout()).toMatch(
        /Named test files at revision \d+: no known failures; 1 test file, each with a current result/,
      );
      const states = withStore(repo, (store) =>
        store.knownStates.list(repo.worktreeId).filter((s) => s.check.testPath === HOLD),
      );
      expect(states.length).toBeGreaterThan(0);
      expect(states.every((s) => s.validity === "current" && s.outcome === "pass")).toBe(true);
    });
  },
);
