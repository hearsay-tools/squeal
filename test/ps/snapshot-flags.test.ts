import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flag } from "../../src/core/ps/flags.js";
import type { Flag, PsModel } from "../../src/core/ps/model.js";
import { takeSnapshot } from "../../src/core/ps/snapshot.js";
import { writeHostRules } from "./fixture-host-rules.js";
import { fakeWindow, type SnapshotHost, snapshotHost } from "./fixture-snapshot.js";
import { type FixtureRepo, makeRepo } from "./fixture-stores.js";

/*
 * Spec 014 D7 through the assembled snapshot (`reviews/wave-2.md` B1, B2 and
 * input 2): the real `flag` over the model the window builds, never a
 * stand-in. The second sample holds Squeal's processes only, so a rule of
 * the whole host must read the first.
 */

let host: SnapshotHost;
let alpha: FixtureRepo;

beforeEach(() => {
  host = snapshotHost();
  alpha = makeRepo(host.base, "alpha");
  host.serve(800, alpha);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(host.base, { recursive: true, force: true });
});

async function snap(f: Flag = flag) {
  const window = fakeWindow();
  return takeSnapshot({
    source: host.source,
    places: host.places,
    flag: f,
    full: false,
    repo: false,
    sampleMs: 2_000,
    now: window.now,
    wait: window.wait,
  });
}

describe("the host-wide rules read the whole host, and a used name whole (reviews/wave-2.md B1, B2)", () => {
  test("a directory a process works in, or names in an argument or an <option>=<path>, is no leftover; an unused one is", async () => {
    const rules = writeHostRules(host);
    const real = vi.fn(flag);
    const { shape, leftovers } = await snap(real);
    // The second sample is the daemon's alone: the processes that use the directories are in the first only.
    const model = real.mock.calls[0]?.[0] as PsModel;
    expect([...model.second.sample.table.keys()]).toEqual([800]);
    expect(leftovers).toEqual(rules.leftovers);
    expect(shape.files.find((f) => f.flag === "leftover-temp")).toMatchObject({
      count: rules.leftovers.length,
    });
  });

  test("a waiter whose parent is gone is an orphan-waiter; one whose parent lives is not", async () => {
    const rules = writeHostRules(host);
    const { shape } = await snap();
    expect(shape.orphans).toEqual([
      {
        pid: rules.goneParent,
        comm: "node",
        startedAt: expect.any(Number),
        flags: [
          {
            flag: "orphan-waiter",
            reason: "its parent 999 is gone",
            command: `kill ${rules.goneParent}`,
          },
        ],
      },
    ]);
    expect(shape.orphans.map((o) => o.pid)).not.toContain(rules.liveParent);
  });
});
