import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { leftovers, marksOf } from "../../src/core/daemon/leftovers.js";
import { storePaths } from "../../src/core/store/index.js";
import { CANCELLED, cancelled } from "../../src/runners/vitest/run.js";
import { resume, stoppedItself, testPause } from "../e2e/restart-evidence.js";
import { runMissingConfig } from "../helpers/baseline.js";
import {
  daemonSuite,
  diagnose,
  type FixtureRepo,
  ping,
  readNotes,
  SLOW,
  waitFor,
  withStore,
} from "./helpers.js";
import { stepDownKit } from "./step-down-helpers.js";

/*
 * Row 011-31 (C9 as amended 2026-10-20, `tasks/011-30/design.md` R1): a
 * step-down cancels the tiers in flight in every lane, as `squeal stop` does
 * (task 001-367), and leaves none of the processes the daemon started. The
 * request is sent alone, as a hook from before this row sends it, with no
 * `stop` after it: the daemon's own cancel is what is checked here.
 */

const suite = daemonSuite();
const { HOOKS, buildAt, start, exitWithin } = stepDownKit(suite);

/** Under a loaded host: Vitest's cancel forces its workers after 1 s, node:test's after 2 s. */
const STEP_DOWN_WITHIN_MS = 15_000;
/** The old daemon stops itself between its socket's unlink and its lock release (task 001-355). */
const STOP_GAP = testPause("stop-gap");

/**
 * A test of `runner` that writes `started-<name>`; while `hold` exists it then
 * waits until `release` exists, at most 150 s.
 */
function heldTest(dir: string, name: string, runner: "vitest" | "node:test"): string {
  const at = (file: string) => JSON.stringify(join(dir, file));
  const from =
    runner === "vitest" ? 'import { it } from "vitest";' : 'import { it } from "node:test";';
  return `import { existsSync, writeFileSync } from "node:fs";
${from}
it("holds while held", { timeout: 170_000 }, async () => {
  writeFileSync(${at(`started-${name}`)}, "");
  if (!existsSync(${at("hold")})) return;
  const deadline = Date.now() + 150_000;
  while (!existsSync(${at("release")}) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!existsSync(${at("release")})) throw new Error("never released");
});
`;
}

const HELD = ["test/held.test.ts", "nt/held.test.mjs"];

/** The failures of this repository's cancelled Vitest runs, from each run's `report.json` (row 011-56). */
function vitestCancels(repo: Pick<FixtureRepo, "commonDir">): string[] {
  const runs = storePaths(repo.commonDir).runsDir;
  return readdirSync(runs).flatMap((id) => {
    if (!existsSync(join(runs, id, "vitest.log"))) return [];
    const { report } = JSON.parse(readFileSync(join(runs, id, "report.json"), "utf8")) as {
      report: { failure: string | null };
    };
    return report.failure?.startsWith(CANCELLED) === true ? [report.failure] : [];
  });
}

/**
 * `buildAt(version)` with the node:test runtime files `tsc` does not emit
 * copied where the compiled `runtime.js` looks for them (`./runtime/`).
 */
function withNodeTest(cli: string): string {
  const runtime = join(dirname(dirname(cli)), "runners/node-test/runtime");
  cpSync(join(import.meta.dirname, "../../src/runners/node-test/runtime"), runtime, {
    recursive: true,
  });
  return cli;
}

describe.runIf(process.platform === "linux")(
  "a step-down cancels its tiers in every lane (row 011-31)",
  SLOW,
  () => {
    it.each([
      ["the baseline's backlog tier and backlog slot", "baseline"],
      ["an edit's tier in each lane", "edit"],
    ] as const)(
      "with %s in flight, cancels both, leaves both files queued and no marked process",
      async (_, heldAt) => {
        const dir = mkdtempSync(join(tmpdir(), "sq-011-31-"));
        if (heldAt === "baseline") writeFileSync(join(dir, "hold"), "");
        suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
        const repo = suite.fixture({
          "squeal.config.json": runMissingConfig(
            JSON.stringify({
              nodeTest: [{ name: "nt", include: ["nt/*.test.mjs"], argv: [], env: {} }],
            }),
          ),
          "test/held.test.ts": heldTest(dir, "vitest", "vitest"),
          "nt/held.test.mjs": heldTest(dir, "node", "node:test"),
        });
        // The pool's size pinned, not the host's CPUs − 1 (001 D11), so both lanes get a grant.
        const userConfig = join(repo.runtimeDir, "config", "squeal");
        mkdirSync(userConfig, { recursive: true });
        writeFileSync(
          join(userConfig, "config.json"),
          `${JSON.stringify({ capacity: { hostSlots: 16 } })}\n`,
        );
        const old = start(withNodeTest(buildAt("0.1.0")), repo, [], STOP_GAP);
        const first = await waitFor(
          () => ping(repo.socketPath, 500),
          60_000,
          "the old daemon serving",
        );
        const rows = () =>
          withStore(repo, (store) =>
            store.testFileKeys
              .list(repo.worktreeId)
              .filter((r) => HELD.includes(r.testFile.path))
              .map((r) => [r.testFile.path, r.pending]),
          );
        const fail = (what: string) => (error: Error) => {
          const started = ["vitest", "node"].filter((n) => existsSync(join(dir, `started-${n}`)));
          throw new Error(
            `${error.message} (${what}); started: ${started.join(", ") || "none"}; rows: ${JSON.stringify(rows())}\n${diagnose(repo, old)}`,
          );
        };
        // Held at the start, the baseline runs a backlog tier of Vitest beside a node:test slot.
        // Otherwise it passes both; then, held, an edit of each runs a tier in each lane at once.
        const passed = () =>
          withStore(repo, (store) =>
            store.knownStates
              .list(repo.worktreeId)
              .filter(
                (s) =>
                  s.check.kind === "test" &&
                  HELD.includes(s.check.testPath) &&
                  s.outcome === "pass" &&
                  s.validity === "current",
              ),
          );
        if (heldAt === "edit") {
          await waitFor(
            () => passed().length === HELD.length || null,
            120_000,
            "both files passed",
          ).catch(fail("baseline"));
          for (const name of ["vitest", "node"]) rmSync(join(dir, `started-${name}`));
          writeFileSync(join(dir, "hold"), "");
          for (const path of HELD) appendFileSync(join(repo.root, path), "// edited\n");
        }
        const both = () =>
          existsSync(join(dir, "started-vitest")) && existsSync(join(dir, "started-node"));
        await waitFor(() => both() || null, 120_000, "both held files running").catch(fail(heldAt));
        // Read while it runs: its record's token is its test processes' mark (`squeal stop`'s way).
        const token = withStore(
          repo,
          (store) => store.worktrees.get(repo.worktreeId)?.daemon?.token,
        );
        expect(token).toBeTruthy();
        const marks = marksOf(first.pid, token ?? null);
        expect(await leftovers(marks)).not.toEqual([]);
        const notes = readNotes(repo).length;

        const at = performance.now();
        const answer = await requestDaemon(
          repo.socketPath,
          { type: "step-down", version: HOOKS },
          5_000,
        );
        expect(answer).toMatchObject({ ok: true, type: "step-down", steppingDown: true });
        const gap = await stoppedItself(first.pid, STEP_DOWN_WITHIN_MS);
        const ms = performance.now() - at;
        try {
          expect(gap, `the old daemon at its lock release within ${STEP_DOWN_WITHIN_MS} ms`).toBe(
            true,
          );
          console.log(
            `011-31: two lanes' step-down (${heldAt}) reached the lock release in ${Math.round(ms)} ms`,
          );
          expect(await leftovers(marks)).toEqual([]);
          expect(rows().sort()).toEqual([
            ["nt/held.test.mjs", "queued"],
            ["test/held.test.ts", "queued"],
          ]);
          expect(
            readNotes(repo)
              .slice(notes)
              .filter((n) => /^daemon stopped/.test(n)),
          ).toHaveLength(1);
          // The Vitest tier's run names the step-down (row 011-56).
          expect(vitestCancels(repo)).toEqual([cancelled("step-down")]);
        } finally {
          writeFileSync(join(dir, "release"), "");
          resume(first.pid);
        }
        expect(await exitWithin(old, 30_000, repo)).toEqual({ code: 0, signal: null });
        expect(await leftovers(marks)).toEqual([]);
      },
    );
  },
);
