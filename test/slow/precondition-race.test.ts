import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/index.js";
import { SLOW } from "../scheduler/helpers.js";
import { waitFor } from "../watcher/helpers.js";
import {
  NODE,
  open,
  pendingSlow,
  scratch,
  skipReason,
  slowPolicy,
  slowRuns,
} from "./precondition-helpers.js";

/*
 * Review wave-8.1 B2 (spec 004 D8 as amended 2026-10-17): a command
 * precondition runs outside the scheduler lock. Its outcome counts only at
 * the revision and rule it checked: one a revision or a policy edit
 * superseded while it ran is dropped, the files stay queued, and the tier
 * checks again at the live revision, running them once it is met.
 */

/**
 * A command that reads whether `ready` exists in the worktree as it starts,
 * marks `started`, holds until `release`, then exits by what it read.
 */
function latched(markers: string): string[] {
  const at = (name: string) => JSON.stringify(join(markers, name));
  const script = [
    'const fs = require("node:fs");',
    'const ready = fs.existsSync("ready");',
    `fs.appendFileSync(${at("started")}, "x");`,
    `const hold = setInterval(() => { if (fs.existsSync(${at("release")})) { clearInterval(hold); process.exit(ready ? 0 : 1); } }, 20);`,
  ].join("\n");
  return [NODE, "-e", script];
}

function latch() {
  const markers = scratch("squeal-004-65-latch-");
  // A command still held at the test's end lets go before its directory is removed.
  const release = () => {
    if (existsSync(markers)) writeFileSync(join(markers, "release"), "");
  };
  onTestFinished(release);
  const started = () => existsSync(join(markers, "started"));
  return { command: latched(markers), release, started };
}

describe("a revision while a precondition command runs (review wave-8.1 B2)", SLOW, () => {
  it("drops the superseded outcome and checks again at the live revision", async () => {
    const { command, release, started } = latch();
    const h = await open({ command, timeoutMs: 60_000 }, { idle: false });
    await waitFor(started, 60_000);
    const before = h.header().revision;
    h.write("ready", "");
    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
    await h.batch("src/math.ts");
    expect(h.header().revision).toBeGreaterThan(before);
    release();
    await waitFor(() => slowRuns(h).length === 2, 60_000);
    await h.scheduler.idle();
    expect(skipReason(h)).toBeNull();
    expect(h.header().slowTier).toMatchObject({ current: 2, notRun: 0 });
  });

  it("drops the outcome of a rule a policy edit replaced while it ran", async () => {
    const { command, release, started } = latch();
    let policy: Policy | null = null;
    const h = await open(
      { command, timeoutMs: 60_000 },
      { idle: false, reloadPolicy: () => policy },
    );
    await waitFor(started, 60_000);
    // The new rule is met at once; the old command, released after, exits 1.
    const slow = slowPolicy({ exists: ["src/strings.ts"] });
    policy = { ...DEFAULT_POLICY, slow };
    h.write("squeal.config.json", JSON.stringify({ slow }));
    await h.batch("squeal.config.json");
    release();
    await waitFor(() => slowRuns(h).length === 2, 60_000);
    await h.scheduler.idle();
    expect(skipReason(h)).toBeNull();
    expect(pendingSlow(h)).toEqual([]);
  });
});
