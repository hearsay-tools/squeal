import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheCheckoutsDir, gitCheckoutsDir } from "../../src/core/checkout/location.js";
import { type CheckoutMarker, treePath, writeMarker } from "../../src/core/checkout/marker.js";
import { leaseProcess } from "../../src/core/daemon/lease-process.js";
import { pidNamespace } from "../../src/core/delivery/harness-process.js";
import { render } from "../../src/core/ps/render.js";
import { type SnapshotOptions, takeSnapshot } from "../../src/core/ps/snapshot.js";
import { shellWord } from "../../src/core/text.js";
import { fakeWindow, NOW, noFlags, type SnapshotHost, snapshotHost } from "./fixture-snapshot.js";

/*
 * Row 023-05 (spec 023 D6): `squeal ps` lists each temporary checkout with
 * its owner's pid and age, and flags one whose owner is gone. The markers
 * are real files; the owners are this process and a child that has exited.
 */

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
let host: SnapshotHost;
let cacheRoot: string;
let commonDir: string;

beforeEach(() => {
  host = snapshotHost();
  cacheRoot = join(host.base, "cache", "squeal", "checkouts");
  commonDir = join(host.base, "repo", ".git");
});

afterEach(() => {
  rmSync(host.base, { recursive: true, force: true });
});

function checkout(dir: string, name: string, owner: CheckoutMarker["owner"], repo = commonDir) {
  const folder = join(dir, name);
  mkdirSync(treePath(folder), { recursive: true });
  writeMarker(folder, { v: 1, owner, commit: COMMIT, commonDir: repo, createdAt: NOW - 90_000 });
  return folder;
}

function deadOwner(): CheckoutMarker["owner"] {
  const ended = spawnSync(process.execPath, ["-e", ""]);
  return { pid: ended.pid as number, startTime: 1, pidNamespace: pidNamespace() };
}

async function snap(repo = false) {
  const window = fakeWindow(() => {});
  const options: SnapshotOptions = {
    source: host.source,
    places: { ...host.places, commonDir, checkoutsRoot: cacheRoot },
    flag: noFlags,
    full: false,
    repo,
    sampleMs: 2_000,
    now: window.now,
    wait: window.wait,
  };
  return takeSnapshot(options);
}

describe("squeal ps and the temporary checkouts", () => {
  it("names a live checkout with its pid and age, and flags a dead one", async () => {
    const live = checkout(cacheCheckoutsDir(cacheRoot, commonDir), "a-live", leaseProcess());
    const dead = checkout(gitCheckoutsDir(commonDir), "b-dead", deadOwner());

    const shape = await snap();

    expect(shape.checkouts).toEqual([
      expect.objectContaining({
        path: treePath(live),
        pid: process.pid,
        commit: COMMIT,
        owner: "live",
        flags: [],
      }),
      expect.objectContaining({
        path: treePath(dead),
        owner: "dead",
        flags: [expect.objectContaining({ flag: "dead-checkout" })],
      }),
    ]);
    expect(shape.flags).toBe(1);
    const text = render(shape, { full: false });
    expect(text.split("\n")[0]).toContain("1 flag: dead-checkout");
    expect(text).toContain("Temporary checkouts");
    expect(text).toContain(`    ${treePath(live)}  pid ${process.pid}  age 1m  at 0123456789ab`);
    expect(text).toContain(`  ! ${treePath(dead)}  pid `);
    expect(text).toContain(`worktree remove --force ${shellWord(treePath(dead))}`);
  });

  it("keeps the current repository's checkouts with --repo", async () => {
    const own = checkout(cacheCheckoutsDir(cacheRoot, commonDir), "own", leaseProcess());
    const other = join(host.base, "other", ".git");
    checkout(cacheCheckoutsDir(cacheRoot, other), "other", leaseProcess(), other);

    expect((await snap(false)).checkouts).toHaveLength(2);
    expect((await snap(true)).checkouts?.map((c) => c.path)).toEqual([treePath(own)]);
  });

  it("prints no checkout block when there is none", async () => {
    const shape = await snap();
    expect(shape.checkouts).toEqual([]);
    expect(render(shape, { full: false })).not.toContain("Temporary checkouts");
  });
});
