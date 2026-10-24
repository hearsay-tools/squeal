import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_DISCARDS } from "../../src/core/scheduler/ledger.js";
import { DEFAULT_POLICY, type Policy, type TestCheckId } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { git, waitFor } from "../watcher/helpers.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Issue 10 (task 011-06, research `001-core-loop/research/issue-10.md`,
 * `probes/issue-10/drive-touch.sh`): a build rewrote a tracked file with its
 * own bytes while the edited test ran. The Vitest adapter heard the touch
 * and withheld the run (task 001-159), and the scheduler left the file
 * `unknown` at its current key with nothing queued, so the edit never got a
 * result. Now the withheld file is queued again as a content discard is,
 * counted toward `MAX_DISCARDS`. Since task 013-02 the adapter withholds
 * only for a file the instance could have read, so the test loads it
 * through a computed `import()`, which no key names.
 */

const HELD = "test/held.test.ts";
const holds: TestCheckId = { kind: "test", project: "", testPath: HELD, fullName: "holds" };

interface Rig {
  readonly h: Harness;
  /** Edits `src/held.ts`, which only `HELD` imports, and hands the batch over. */
  edit(): Promise<void>;
  /** Rewrites `dist/out.js` with its own bytes during each of the next `times` runs of `HELD`. */
  touchDuring(times: number): Promise<void>;
  runs(): number;
}

async function rig(policy: Partial<Policy> = {}): Promise<Rig> {
  const repo = createRepo();
  const started = join(repo.dir, "started");
  const released = join(repo.dir, "released");
  const at = (path: string) => join(repo.main, path);
  writeFileSync(at("src/held.ts"), "export const value = 1;\n");
  mkdirSync(at("dist"));
  writeFileSync(at("dist/out.js"), "export const built = true;\n");
  writeFileSync(
    at(HELD),
    [
      `import { appendFileSync, existsSync, readFileSync } from "node:fs";`,
      `import { expect, it } from "vitest";`,
      `import { value } from "../src/held.ts";`,
      `const length = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").length : 0);`,
      `it("holds", async () => {`,
      // Through Vite, by a specifier it cannot see: no key names it (task 013-02).
      `  const { built } = await import(/* @vite-ignore */ ["..", "dist", "out.js"].join("/"));`,
      `  expect(built).toBe(true);`,
      `  appendFileSync(${JSON.stringify(started)}, "x");`,
      `  const run = length(${JSON.stringify(started)});`,
      `  while (length(${JSON.stringify(released)}) < run) await new Promise((r) => setTimeout(r, 10));`,
      `  expect(value).toBeGreaterThan(0);`,
      `});`,
      "",
    ].join("\n"),
  );
  git(repo.main, "add", "-A");
  git(repo.main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "held");
  const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
    tierSize: 1,
    runnerPartBesideRun: true,
    policy,
  });
  let heard: (() => void) | null = null;
  const invalidate = h.runner.invalidate;
  h.runner.invalidate = async (paths) => {
    const result = await invalidate(paths);
    if (paths.some((p) => p.kind === "touch" && p.path === "dist/out.js")) heard?.();
    return result;
  };
  const count = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").length : 0);
  // Every run of `HELD` the test does not hold is released as it starts.
  writeFileSync(released, "x".repeat(1_000));
  await h.scheduler.start();
  await h.scheduler.idle();
  return {
    h,
    async edit() {
      writeFileSync(at("src/held.ts"), `export const value = ${count(started) + 2};\n`);
      await h.batch("src/held.ts");
    },
    async touchDuring(times) {
      const base = count(started);
      writeFileSync(released, "x".repeat(base));
      for (let i = 1; i <= times; i++) {
        await waitFor(() => count(started) >= base + i, 60_000);
        const touch = new Promise<void>((resolve) => {
          heard = resolve;
        });
        writeFileSync(at("dist/out.js"), readFileSync(at("dist/out.js")));
        await h.batch("dist/out.js");
        await touch;
        appendFileSync(released, "x");
      }
      appendFileSync(released, "x".repeat(1_000));
    },
    runs: () => h.runsOf(HELD).length,
  };
}

describe("a run the runner withheld for a touch no key names (issue 10, task 011-06)", SLOW, () => {
  it("queues the edited file again, so it is current after one more run", async () => {
    const r = await rig(RUN_MISSING);
    const before = r.runs();
    await r.edit();
    await r.touchDuring(1);
    await r.h.scheduler.idle();

    const runs = r.h.runsOf(HELD).slice(before);
    expect(runs).toHaveLength(2);
    expect(runs[0]?.report.failure).toMatch(/dist\/out\.js was written during this run/);
    expect(runs[0]?.report.completedFiles).toEqual([]);
    expect(runs[1]?.report.completedFiles.map((f) => f.path)).toEqual([HELD]);
    expect(r.h.sink.stateOf(holds)).toMatchObject({ outcome: "pass", validity: "current" });
    expect(r.h.header()).toMatchObject({
      counts: { pending: 0, unknown: 0 },
      testFilesWithoutChecks: { pending: 0, unknown: 0 },
    });
  });

  it("is unknown with the runner's reason after MAX_DISCARDS withheld runs in a row", async () => {
    const r = await rig();
    const before = r.runs();
    await r.edit();
    await r.touchDuring(MAX_DISCARDS);
    await r.h.scheduler.idle();

    expect(r.runs() - before).toBe(MAX_DISCARDS);
    const reasons = r.h.sink
      .callsOf("markUnknown")
      .filter((call) => call.testFiles.some((f) => f.path === HELD))
      .map((call) => call.reason);
    expect(reasons).toEqual([expect.stringMatching(/dist\/out\.js was written during this run/)]);
    expect(r.h.header()).toMatchObject({ counts: { pending: 0 } });

    // It stays unknown at that key: an edit elsewhere runs other files, never this one again.
    r.h.write("src/strings.ts", `${readFileSync(join(r.h.root, "src/strings.ts"), "utf8")}\n`);
    await r.h.batch("src/strings.ts");
    await r.h.scheduler.idle();
    expect(r.runs() - before).toBe(MAX_DISCARDS);
  });

  it("leaves a lookup-only startup unchanged: only the edited file runs, once more", async () => {
    const r = await rig({ baseline: { ...DEFAULT_POLICY.baseline, onStart: "lookup-only" } });
    expect(r.h.runner.runs).toEqual([]);
    await r.edit();
    await r.touchDuring(1);
    await r.h.scheduler.idle();

    expect(r.runs()).toBe(2);
    expect(r.h.runner.runs.flatMap((run) => run.files.map((f) => f.path))).toEqual([HELD, HELD]);
    expect(r.h.sink.stateOf(holds)).toMatchObject({ outcome: "pass", validity: "current" });
    expect(r.h.header()).toMatchObject({ counts: { pending: 0 } });
  });
});
