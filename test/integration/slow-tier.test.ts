import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import {
  createRepo,
  type Harness,
  openHarness,
  openRepoStore,
  SLOW,
} from "../scheduler/helpers.js";

/*
 * Spec 004 goals 1, 2 and 4 on a repository shaped like this one: a Vitest
 * e2e directory marked slow, keyed by the build output it tests (D5). The
 * scheduler, the real Vitest adapter, the store and the real HarnessDelivery
 * together. While the agent is in a turn, an edit's fast failure is delivered
 * and the slow file has not run; the silent Stop records it pending (D9), it
 * runs once the consumer is idle, and the idle waiter wakes the agent with
 * its failure.
 */

const E2E = "test/e2e/cli.test.ts";
const ARTIFACT = "dist/cli.js";
const E2E_TEST = [
  'import { expect, it } from "vitest";',
  'import { shout } from "../../dist/cli.js";',
  "",
  'it("shouts", () => {',
  '  expect(shout("hi")).toBe("HI!");',
  "});",
  "",
].join("\n");
const BUILT = 'export const shout = (s) => s.toUpperCase() + "!";\n';
const REBUILT_BROKEN = 'export const shout = (s) => s.toLowerCase() + "!";\n';
const BROKEN_UPPER = "export const upper = (s: string) => s.toLowerCase();\n";

const slotDirs: string[] = [];
afterEach(() => {
  for (const dir of slotDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

const ranE2e = (h: Harness) => h.runsOf(E2E).length;

describe("a slow e2e file behind an edit's fast tests (spec 004 D2, D9)", SLOW, () => {
  it("delivers the fast failure first, then runs the slow file once the consumer is idle", async () => {
    const repo = createRepo();
    write(repo.main, E2E, E2E_TEST);
    write(repo.main, ARTIFACT, BUILT);
    const store = openRepoStore(repo.commonDir);
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-12-slot-"));
    slotDirs.push(slotDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      policy: {
        slow: { ...DEFAULT_POLICY.slow, include: ["test/e2e/**/*.test.ts"] },
        inputs: { "test/e2e/**/*.test.ts": ["dist/**"] },
      },
      slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
    });
    const { delivery, consumer } = await h.consumer();
    await delivery.startTurn(consumer);
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(ranE2e(h)).toBe(0);
    await delivery.onToolBoundary(consumer);

    // An edit and its rebuild: the fast files that import the source run and report first.
    write(repo.main, "src/strings.ts", BROKEN_UPPER);
    write(repo.main, ARTIFACT, REBUILT_BROKEN);
    await h.batch("src/strings.ts", ARTIFACT);
    await h.scheduler.idle();
    const fast = await delivery.onToolBoundary(consumer);
    const failed = (fast?.entries ?? []).map((e) => e.check.testPath);
    expect(failed).toContain("test/upper.test.ts");
    expect(failed).not.toContain(E2E);
    expect(ranE2e(h)).toBe(0);

    // A silent Stop: the consumer is idle, the slow file runs, the idle waiter wakes the agent.
    await delivery.endTurn(consumer);
    const woken = await delivery.waitForDelta(consumer, { timeoutMs: 90_000 });
    expect(ranE2e(h)).toBe(1);
    expect(woken?.entries.map((e) => [e.check.testPath, e.check.kind])).toEqual([[E2E, "test"]]);
    expect(woken?.entries[0]?.to).toBe("fail");
  });
});
