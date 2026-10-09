import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatRegistration } from "../../src/core/delivery/index.js";
import { OPTIMIZER_OFF_NOTE, optimizerOffNote } from "../../src/core/state/optimizer-note.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import { SEPARATE } from "./optimizer-repo.js";
import {
  BASE,
  createRepo,
  freshOutcomes,
  NEW,
  OLD,
  slowOptions,
  stored,
  warmOptions,
  withSlowLanes,
} from "./stamps-repo.js";
import { OPTIMIZED } from "./touched-repo.js";

/*
 * Task 001-176: the regressions of reviews wave-13f B3 and S1 with Vitest's
 * dependency optimizer off. Each stores what a fresh adapter gives on the
 * bytes on disk, observed or not.
 */

const P_TEST = { project: "p", path: "test/optimized.test.ts" };
const ROOT_TEST = { project: "", path: "test/optimized.test.ts" };

/**
 * The reviewer's step 1: an adapter started while `src/mod.js` holds
 * `transient` runs project p's test and closes, leaving its optimizer cache;
 * then `OLD` is written back before anything else starts.
 */
async function builtOn(root: string, transient: string, observe: boolean): Promise<void> {
  const mod = join(root, "src/mod.js");
  writeFileSync(mod, transient);
  try {
    const adapter = await createVitestAdapter({ root, observe: () => observe });
    try {
      const report = await adapter.run([P_TEST], warmOptions(root));
      expect(report.results.map((r) => r.outcome)).toEqual(["pass"]);
    } finally {
      await adapter.close();
    }
  } finally {
    writeFileSync(mod, OLD);
  }
}

/** Every optimizer cache of the fixture: Vitest keeps a project's under the root's `node_modules`. */
const cacheOf = (root: string) => join(root, "node_modules/.vite");

/** Whether a bundle in the fixture's optimizer cache holds `NEW`'s value, and `OLD`'s. */
function bundles(root: string): { new: boolean; old: boolean } {
  const texts = readdirSync(cacheOf(root), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"));
  return {
    new: texts.some((text) => text.includes('which = "new"')),
    old: texts.some((text) => text.includes('which = "old"')),
  };
}

describe("a separately configured project's optimizer across a restart (review wave-13f B3)", () => {
  it(
    "fails on the bytes on disk under a fresh adapter with no cache (the control)",
    SLOW,
    async () => {
      const repo = createRepo(SEPARATE);
      rmSync(cacheOf(repo.main), { recursive: true, force: true });
      expect(await freshOutcomes(repo.main, [P_TEST])).toEqual([
        ["p", "test/optimized.test.ts", "fail"],
      ]);
    },
  );

  it.each([true, false])(
    "runs the disk under a new adapter, a restarted scheduler and its forced checkpoint (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(SEPARATE);
      await builtOn(repo.main, NEW, observe);
      expect(existsSync(cacheOf(repo.main))).toBe(true);

      expect(await freshOutcomes(repo.main, [P_TEST])).toEqual([
        ["p", "test/optimized.test.ts", "fail"],
      ]);

      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        observe,
      });
      await h.scheduler.start();
      await h.scheduler.idle();
      expect(stored(h)).toEqual([["p", "test/optimized.test.ts", "current", "fail"]]);
      const before = h.runsOf("test/optimized.test.ts").length;
      await h.scheduler.requestFullSuite({ force: true });
      await h.scheduler.idle();
      expect(h.runsOf("test/optimized.test.ts").length).toBeGreaterThan(before);
      expect(stored(h)).toEqual([["p", "test/optimized.test.ts", "current", "fail"]]);
    },
  );

  it.each([true, false])(
    "runs the disk in a slow instance made from a kept cache that bundled NEW (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(SEPARATE);
      const { slotDir, ...options } = slowOptions(["test/optimized.test.ts"]);
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        ...options,
        observe,
      });
      // Review wave-13h S2: opening the harness built the cache on OLD and `builtOn`
      // would keep it, so the slow instance would read OLD whatever it did.
      rmSync(cacheOf(repo.main), { recursive: true, force: true });
      await builtOn(repo.main, NEW, observe);
      expect(bundles(repo.main)).toEqual({ new: true, old: false });
      expect(await freshOutcomes(repo.main, [P_TEST])).toEqual([
        ["p", "test/optimized.test.ts", "fail"],
      ]);
      expect(bundles(repo.main)).toEqual({ new: true, old: false });
      const lanes = withSlowLanes(h, repo.main, slotDir, async () => {});
      await h.scheduler.start();
      await h.scheduler.idle();
      expect(lanes.made()).toBeGreaterThan(0);
      expect(stored(h)).toEqual([["p", "test/optimized.test.ts", "current", "fail"]]);
    },
  );
});

describe("an ordinary edit of a source the optimizer bundled (review wave-13f S1)", () => {
  it("fails on the edited bytes under a fresh adapter (the control)", SLOW, async () => {
    const repo = createRepo(OPTIMIZED);
    expect(await freshOutcomes(repo.main, [ROOT_TEST])).toEqual([
      ["", "test/optimized.test.ts", "fail"],
    ]);
  });

  it.each([true, false])(
    "stores what the edited bytes give (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo({ ...OPTIMIZED, "src/mod.js": NEW });
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        observe,
      });
      await h.scheduler.start();
      await h.scheduler.idle();
      expect(stored(h)).toEqual([["", "test/optimized.test.ts", "current", "pass"]]);

      h.write("src/mod.js", OLD);
      await h.batch("src/mod.js");
      await h.scheduler.idle();
      expect(stored(h)).toEqual([["", "test/optimized.test.ts", "current", "fail"]]);
    },
  );
});

describe("a config that turns the optimizer on (001-176)", () => {
  it("is told once, in the registration header and in status", SLOW, async () => {
    const repo = createRepo(OPTIMIZED);
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
    await h.scheduler.start();
    await h.scheduler.idle();
    // A recreate starts another instance; the note is not repeated.
    await h.runner.invalidate([{ path: "vitest.config.ts", kind: "change" }]);
    const once = (text: string) => text.split(OPTIMIZER_OFF_NOTE).length - 1;

    const { delivery, consumer } = await h.consumer();
    const registered = formatRegistration(await delivery.register(consumer));
    expect(registered).toContain(optimizerOffNote([""]));
    expect(once(registered)).toBe(1);
    const status = readStatus(h.root);
    expect(once(formatStatus(status, Date.now()))).toBe(1);
  });

  it(
    "is no longer told in the header once the config turns it off (review wave-13h S1)",
    SLOW,
    async () => {
      const repo = createRepo(OPTIMIZED);
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
      await h.scheduler.start();
      await h.scheduler.idle();
      const first = await h.consumer("first");
      expect(formatRegistration(await first.delivery.register(first.consumer))).toContain(
        optimizerOffNote([""]),
      );

      const before = h.runsOf("test/optimized.test.ts").length;
      const config = OPTIMIZED["vitest.config.ts"] ?? "";
      h.write("vitest.config.ts", config.replaceAll("enabled: true", "enabled: false"));
      await h.batch("vitest.config.ts");
      await h.scheduler.idle();
      // The recreated instance ran the test under the new config.
      expect(h.runsOf("test/optimized.test.ts").length).toBeGreaterThan(before);

      const { delivery, consumer } = await h.consumer("second");
      expect(formatRegistration(await delivery.register(consumer))).not.toContain(
        OPTIMIZER_OFF_NOTE,
      );
      // Status keeps it among the dated notes: what an earlier config did.
      expect(formatStatus(readStatus(h.root), Date.now())).toContain(OPTIMIZER_OFF_NOTE);

      // Turned on again, the header tells it again.
      h.write("vitest.config.ts", config);
      await h.batch("vitest.config.ts");
      await h.scheduler.idle();
      const again = await h.consumer("again");
      expect(formatRegistration(await again.delivery.register(again.consumer))).toContain(
        optimizerOffNote([""]),
      );
    },
  );

  it("is not told for a config that leaves it off", SLOW, async () => {
    const repo = createRepo({ ...OPTIMIZED, "vitest.config.ts": BASE["vitest.config.ts"] ?? "" });
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
    await h.scheduler.start();
    await h.scheduler.idle();
    const { delivery, consumer } = await h.consumer();
    expect(formatRegistration(await delivery.register(consumer))).not.toContain(OPTIMIZER_OFF_NOTE);
  });
});
