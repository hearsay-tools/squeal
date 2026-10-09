import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { type Harness, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import { BASE, createRepo, slowOptions, stored, withSlowLanes } from "./stamps-repo.js";
import { touchHeard } from "./touched-repo.js";

/*
 * Task 001-159: a touch heard while a run is in flight. When something else
 * wrote the file, the run may have read its other bytes from any cache, so
 * none of its files is stored; they are unknown with a reason that names
 * the file, as task 001-146 does for a file that moved during a run. An
 * unknown file has no stored state. When the run wrote the file itself, a
 * fresh run of the same bytes writes it too: observed, the run is stored.
 *
 * `test/holds.test.ts` writes `flags/started` (git-ignored) and waits for
 * `flags/heard`; with `SELF` it first rewrites `fixtures/data.txt` with the
 * bytes it holds, as a fixture writer does on every run.
 */

const holds = (self: boolean) =>
  [
    'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
    'import { setTimeout as sleep } from "node:timers/promises";',
    'import { expect, it } from "vitest";',
    'import { which } from "../src/mod.ts";',
    "",
    'const at = (path: string) => new URL("../" + path, import.meta.url);',
    'it("passes on the bytes on disk", async () => {',
    self ? '  writeFileSync(at("fixtures/data.txt"), readFileSync(at("fixtures/data.txt")));' : "",
    '  writeFileSync(at("flags/started"), "");',
    '  for (let i = 0; i < 600 && !existsSync(at("flags/heard")); i++) await sleep(50);',
    '  expect(which).toBe("old");',
    "});",
    "",
  ].join("\n");

const files = (self: boolean): Readonly<Record<string, string>> => ({
  ...BASE,
  ".gitignore": "node_modules/\nflags/\n",
  "flags/.keep": "\n",
  "fixtures/data.txt": "data\n",
  "test/holds.test.ts": holds(self),
  "test/other.test.ts": 'import { it } from "vitest";\nit("passes", () => {});\n',
});

/**
 * Starts the scheduler. Once the run started, `path` is rewritten with its
 * own bytes (unless the run did it), the batch is handed over, and the run
 * ends once the runner heard the touch.
 */
async function touchDuringRun(h: Harness, path: string, rewrite: boolean): Promise<void> {
  const heard = touchHeard(h);
  await h.scheduler.start();
  const started = join(h.root, "flags/started");
  for (let i = 0; i < 1200 && !existsSync(started); i++) await sleep(25);
  expect(existsSync(started)).toBe(true);
  if (rewrite) h.write(path, readFileSync(join(h.root, path), "utf8"));
  await h.batch(path);
  await heard;
  writeFileSync(join(h.root, "flags/heard"), "");
  await h.scheduler.idle();
}

const reason = (path: string) =>
  new RegExp(`${path} was written during this run and ended as it was.*task 001-159`);

/** The reasons `markUnknown` stored for `path`. */
const reasons = (h: Harness, path: string) =>
  h.sink
    .callsOf("markUnknown")
    .filter((call) => call.testFiles.some((f) => f.path === path))
    .map((call) => call.reason);

describe("a touch heard during a run (task 001-159)", () => {
  it.each([true, false])(
    "stores none of the run's files when another wrote it (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(files(false));
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        tierSize: 4,
        runnerPartBesideRun: true,
        observe,
      });
      await touchDuringRun(h, "src/mod.ts", true);

      expect(stored(h)).toEqual([]);
      expect(reasons(h, "test/holds.test.ts")).toEqual([
        expect.stringMatching(reason("src/mod.ts")),
      ]);
      expect(reasons(h, "test/other.test.ts")).toEqual([
        expect.stringMatching(reason("src/mod.ts")),
      ]);
    },
  );

  // Spec 004 D2: the slow instance hears it at once, not before its next run.
  it("stores none of a slow run's files", SLOW, async () => {
    const repo = createRepo(files(false));
    const { slotDir, ...options } = slowOptions(["test/holds.test.ts", "test/other.test.ts"]);
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      ...options,
      runnerPartBesideRun: true,
    });
    const lanes = withSlowLanes(h, repo.main, slotDir, async () => {});
    await touchDuringRun(h, "src/mod.ts", true);

    // One slow file per run: the other ran after the touch, on an instance made after it.
    expect(lanes.made()).toBe(1);
    expect(stored(h)).toEqual([["", "test/other.test.ts", "current", "pass"]]);
    expect(reasons(h, "test/holds.test.ts")).toEqual([expect.stringMatching(reason("src/mod.ts"))]);
  });
});

describe("a test file that rewrites a worktree file with its own bytes on every run (task 001-159)", () => {
  /** Edits the test file, so its key moves and it runs again, until idle. */
  async function runAgain(h: Harness, edit: number): Promise<void> {
    const heard = touchHeard(h);
    writeFileSync(join(h.root, "flags/heard"), "");
    h.write("test/holds.test.ts", `${holds(true)}// edit ${edit}\n`);
    await h.batch("test/holds.test.ts");
    await h.scheduler.idle();
    // The run's write reaches the runner after the run, as a touch with no revision.
    await h.batch("fixtures/data.txt");
    await heard;
    await h.scheduler.idle();
  }

  it("is stored as it ran, when observed, and settles", SLOW, async () => {
    const repo = createRepo(files(true));
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      tierSize: 4,
      runnerPartBesideRun: true,
      observe: true,
    });
    await touchDuringRun(h, "fixtures/data.txt", false);
    expect(stored(h)).toEqual([
      ["", "test/holds.test.ts", "current", "pass"],
      ["", "test/other.test.ts", "current", "pass"],
    ]);

    await runAgain(h, 1);
    await runAgain(h, 2);
    // Once per key: the touch its own run makes queues no run of it.
    expect(h.runsOf("test/holds.test.ts")).toHaveLength(3);
    expect(stored(h)).toEqual([
      ["", "test/holds.test.ts", "current", "pass"],
      ["", "test/other.test.ts", "current", "pass"],
    ]);
  });

  it(
    "is unknown with the reason when not observed and heard during its run, and settles",
    SLOW,
    async () => {
      const repo = createRepo(files(true));
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        tierSize: 4,
        runnerPartBesideRun: true,
      });
      await touchDuringRun(h, "fixtures/data.txt", false);
      expect(stored(h)).toEqual([]);
      expect(reasons(h, "test/holds.test.ts")).toEqual([
        expect.stringMatching(reason("fixtures/data.txt")),
      ]);

      // A run that ended before its own touch was heard is stored.
      await runAgain(h, 1);
      expect(h.runsOf("test/holds.test.ts")).toHaveLength(2);
      expect(stored(h)).toEqual([["", "test/holds.test.ts", "current", "pass"]]);
    },
  );
});
