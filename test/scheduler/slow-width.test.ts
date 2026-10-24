import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireSlowSlot } from "../../src/core/slow/index.js";
import { DEFAULT_POLICY, isSlowLane, type RunOptions } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Review 001-394 B2 (row 001-378): Vitest runs a tier under the project's own
 * `maxWorkers` (001 D11 Runner ceiling), so a slow tier of more files than
 * that starts the rest only as the first ones end: after an edit or a close,
 * which 004 D2 forbids ("a slow tier of several files starts them all at
 * once"). The slow tier takes only as many files as the runner starts at
 * once (`RunnerAdapter.slowWidth`); the rest stay queued for a later tier.
 *
 * The real scheduler over the real Vitest adapter, the `basic` fixture's
 * config at `maxWorkers: 2`, `slow.maxParallel` 4 and four slow files. Each
 * slow run is dispatched as Vitest's pool dispatches it: its first two files
 * start, and a third only as one of them ends.
 */

const SLOW_FILES = [
  "test/gen.test.ts",
  "test/plain.test.ts",
  "test/strings.test.ts",
  "test/upper.test.ts",
];
const PROJECT_WIDTH = 2;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `squeal-001-394-${name}-`));
  dirs.push(dir);
  return dir;
}

/** A file of a slow run starting, as Vitest's pool starts it, or a fast run starting. */
type Event = { kind: "slow"; path: string; run: number } | { kind: "fast"; paths: string[] };

interface Held {
  readonly h: Harness;
  readonly slotDir: string;
  readonly events: Event[];
  readonly slowRuns: { files: string[]; options: RunOptions }[];
  /** Ends the first slow run's first files: the pool starts the next, if it has any. */
  release(): void;
}

async function open(): Promise<Held> {
  const repo = createRepo();
  writeFileSync(
    join(repo.main, "vitest.config.ts"),
    `import { defineConfig } from "vitest/config";\n\nexport default defineConfig({\n` +
      `  test: { include: ["test/**/*.test.ts"], testTimeout: 60_000, maxWorkers: ${PROJECT_WIDTH} },\n});\n`,
  );
  const store = openRepoStore(repo.commonDir);
  const slotDir = tempDir("slot");
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    policy: {
      ...RUN_MISSING,
      slow: { ...DEFAULT_POLICY.slow, include: SLOW_FILES, maxParallel: 4 },
    },
    slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
    runnerPartBesideRun: true,
    capacity: { dir: join(tempDir("pool"), "squeal-uid"), hostSlots: 8 },
  });
  const events: Event[] = [];
  const slowRuns: Held["slowRuns"] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = h.runner.run.bind(h.runner);
  h.runner.run = async (files, options) => {
    const paths = files.map((f) => f.path);
    if (options.lane === undefined || !isSlowLane(options.lane)) {
      events.push({ kind: "fast", paths });
      return run(files, options);
    }
    const index = slowRuns.push({ files: paths, options }) - 1;
    const start = (path: string) => events.push({ kind: "slow", path, run: index });
    for (const path of paths.slice(0, PROJECT_WIDTH)) start(path);
    if (index === 0) await held;
    for (const path of paths.slice(PROJECT_WIDTH)) start(path);
    return run(files, options);
  };
  return { h, slotDir, events, slowRuns, release };
}

const slowStarts = (events: readonly Event[]) =>
  events.filter((e): e is Extract<Event, { kind: "slow" }> => e.kind === "slow");

/** How many of the slot's four permits another worktree could take now. */
function freePermits(dir: string): number {
  const owner = { pid: process.pid, worktreeId: "probe" };
  const probe = acquireSlowSlot({ dir, owner, permits: 4, want: 4 });
  const free = probe?.permits ?? 0;
  probe?.release();
  return free;
}

describe(
  "a slow tier takes only the files its run starts at once (review 001-394 B2)",
  SLOW,
  () => {
    it("leaves the rest queued past an edit, for a later tier, with the slot and pool shrunk", async () => {
      const { h, slotDir, events, slowRuns, release } = await open();
      await h.scheduler.start();
      await waitFor(() => slowStarts(events).length === PROJECT_WIDTH, 60_000);
      const edit = events.length;
      try {
        // Two files hold two permits and two files' workers (slow.maxWorkers 2 each), no more.
        expect(slowRuns[0]?.files).toHaveLength(PROJECT_WIDTH);
        expect(freePermits(slotDir)).toBe(4 - PROJECT_WIDTH);
        expect(slowRuns[0]?.options.workers).toBe(PROJECT_WIDTH * DEFAULT_POLICY.slow.maxWorkers);
        h.write("src/math.ts", "export const add = (a: number, b: number) => b + a;\n");
        await h.batch("src/math.ts");
      } finally {
        release();
      }
      await waitFor(() => slowStarts(events).length === SLOW_FILES.length, 60_000);
      await h.scheduler.idle();

      const starts = slowStarts(events);
      expect(new Set(starts.map((s) => s.path))).toEqual(new Set(SLOW_FILES));
      // The first tier's files all started at once; the others in a tier of their own.
      expect(starts.filter((s) => s.run === 0)).toHaveLength(PROJECT_WIDTH);
      expect(starts.filter((s) => s.run > 0).every((s) => s.run === 1)).toBe(true);
      // That tier was selected once the edit's fast tier ran: none of its files started before.
      const editTier = events.findIndex(
        (e, i) => i >= edit && e.kind === "fast" && e.paths.includes("test/math.test.ts"),
      );
      const later = events.findIndex((e) => e.kind === "slow" && e.run === 1);
      expect(editTier).toBeGreaterThanOrEqual(edit);
      expect(later).toBeGreaterThan(editTier);
    });

    it("starts none of the rest once the scheduler closes", async () => {
      const { h, events, slowRuns, release } = await open();
      await h.scheduler.start();
      await waitFor(() => slowStarts(events).length === PROJECT_WIDTH, 60_000);
      const closed = h.scheduler.close();
      release();
      await closed;
      expect(slowRuns).toHaveLength(1);
      expect(slowStarts(events)).toHaveLength(PROJECT_WIDTH);
    });
  },
);
