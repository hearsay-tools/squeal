import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import { formatWhy } from "../../src/core/status/format-why.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import { readWhy } from "../../src/core/status/why.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { openHarness, openRepoStore, SLOW } from "./helpers.js";
import { idleAfterQuiet } from "./quiet-clock.js";

import { A, B, DATA, fixture, OUT, rules, scoped, text } from "./runtime-files-fixture.js";

describe("runtime-file lifecycle", SLOW, () => {
  it("uses raw-only records without a first-seen rerun, and restores tracking on reload", async () => {
    const repo = fixture(false);
    const store = openRepoStore(repo.commonDir);
    let next = scoped;
    const h = await openHarness(repo.main, store, repo.commonDir, {
      observe: true,
      policy: scoped,
      reloadPolicy: (changes) =>
        changes.some((c) => c.path === "squeal.config.json") ? next : null,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(h.runsOf(A)).toHaveLength(1);
    expect(h.runsOf(B)).toHaveLength(1);
    expect(JSON.parse(store.meta.get(observedMetaKey("")) ?? "{}")[A]).toContain(DATA);
    expect(h.scheduler.extraFiles()).not.toContain(DATA);
    const before = [h.keyOf(A), h.keyOf(B)];
    h.write(DATA, text(4321));
    await h.scheduler.idle();
    expect([h.keyOf(A), h.keyOf(B)]).toEqual(before);
    expect(h.runsOf(A)).toHaveLength(1);
    next = { ...DEFAULT_POLICY, ...RUN_MISSING };
    h.write("squeal.config.json", "{}\n");
    await h.batch("squeal.config.json");
    await idleAfterQuiet(h);
    expect(h.keyOf(A)).not.toBe(before[0]);
    expect(h.scheduler.extraFiles()).toContain(DATA);
    const restored = h.keyOf(A);
    h.write(DATA, text(4322));
    await h.batch(DATA);
    await idleAfterQuiet(h);
    expect(h.keyOf(A)).not.toBe(restored);
  });

  it("rebuilds selected saved assembled closures before lookup, without a descriptor-only startup revision", async () => {
    const repo = fixture(false);
    const store = openRepoStore(repo.commonDir);
    const old = await openHarness(repo.main, store, repo.commonDir, {
      observe: true,
      policy: RUN_MISSING,
    });
    await old.scheduler.start();
    await old.scheduler.idle();
    expect(store.testFiles.get({ project: "", path: A })?.closure.paths).toContain(DATA);
    await old.scheduler.close();
    const before = store.revisions.latest(old.worktreeId)?.number ?? 0;
    writeFileSync(join(repo.main, DATA), text(2000));
    const fresh = await openHarness(repo.main, store, repo.commonDir, {
      observe: true,
      policy: scoped,
    });
    await fresh.scheduler.start();
    await fresh.scheduler.idle();
    expect(store.revisions.latest(fresh.worktreeId)?.number ?? 0).toBe(before);
    expect(store.testFiles.get({ project: "", path: A })?.closure.paths).not.toContain(DATA);
    expect(fresh.runsOf(A)).toHaveLength(1);
    await fresh.scheduler.close();
    writeFileSync(join(repo.main, DATA), text(2001));
    const again = await openHarness(repo.main, store, repo.commonDir, {
      observe: true,
      policy: scoped,
    });
    await again.scheduler.start();
    await again.scheduler.idle();
    expect(again.runner.runs).toEqual([]);
    expect(
      store.revisions.latest(again.worktreeId)?.number ?? 0,
      JSON.stringify(store.revisions.latest(again.worktreeId)),
    ).toBe(before);
  });

  it("retains the outside reader's startup change and watch through atomic replacement", async () => {
    const repo = fixture();
    const store = openRepoStore(repo.commonDir);
    const old = await openHarness(repo.main, store, repo.commonDir, {
      observe: true,
      policy: RUN_MISSING,
    });
    await old.scheduler.start();
    await old.scheduler.idle();
    await old.scheduler.close();
    writeFileSync(join(repo.main, DATA), text(2000));
    const h = await openHarness(repo.main, store, repo.commonDir, {
      observe: true,
      policy: scoped,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(store.revisions.latest(h.worktreeId)?.changes.map((c) => c.path)).toContain(DATA);
    expect(h.scheduler.extraFiles()).toContain(DATA);
    const keys = [h.keyOf(A), h.keyOf(B), h.keyOf(OUT)];
    h.write(`${DATA}.tmp`, text(2001));
    renameSync(join(h.root, `${DATA}.tmp`), join(h.root, DATA));
    await h.batch(DATA);
    await idleAfterQuiet(h);
    expect([h.keyOf(A), h.keyOf(B)]).toEqual(keys.slice(0, 2));
    expect(h.keyOf(OUT)).not.toBe(keys[2]);
  });

  it("keeps a selected reader unknown and its descriptor tracked when fresh discovery fails", async () => {
    const repo = fixture(false);
    const store = openRepoStore(repo.commonDir);
    const old = await openHarness(repo.main, store, repo.commonDir, {
      observe: true,
      policy: RUN_MISSING,
    });
    await old.scheduler.start();
    await old.scheduler.idle();
    await old.scheduler.close();
    writeFileSync(join(repo.main, DATA), text(2000));
    const h = await openHarness(repo.main, store, repo.commonDir, {
      observe: true,
      policy: scoped,
      failing: ["closure"],
      allowErrors: true,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(h.keyOf(A)).toBeNull();
    expect(h.scheduler.extraFiles()).toContain(DATA);
    expect(h.header().counts.current).toBe(0);
  });
  it("reports applied, conflicting and offline pending runtime policy from worktree snapshots", async () => {
    const repo = fixture(false);
    const store = openRepoStore(repo.commonDir);
    const policy = {
      ...scoped,
      runtimeFiles: [{ ...rules[0], project: "", tests: [A, B], paths: [DATA, A] }],
    };
    writeFileSync(
      join(repo.main, "squeal.config.json"),
      JSON.stringify({ runtimeFiles: policy.runtimeFiles }),
    );
    const h = await openHarness(repo.main, store, repo.commonDir, { observe: true, policy });
    await h.scheduler.start();
    await h.scheduler.idle();
    const current = readStatus(h.root);
    expect(current).toMatchObject({
      runtimeFiles: {
        pending: false,
        readers: expect.arrayContaining([
          expect.objectContaining({
            testFile: { project: "", path: A },
            paths: [DATA],
            conflicts: [{ path: A, reason: "test file" }],
          }),
        ]),
      },
    });
    const full = formatStatus(current, Date.now(), "squeal", { full: true });
    expect(full).toContain(`Runtime file: ${DATA} (observed bytes excluded by policy)`);
    expect(full).toContain(`Runtime file conflict: ${A}`);
    expect(full).toContain("Cached test results do not prove a runtime server is alive.");
    const why = readWhy(h.root, `${A} > runtime reader`);
    expect(why).toMatchObject({
      found: true,
      runtimeFiles: {
        pending: false,
        readers: [expect.objectContaining({ testFile: { project: "", path: A } })],
      },
    });
    expect(formatWhy(why)).toContain(`Runtime file: ${DATA}`);
    await h.scheduler.close();
    writeFileSync(join(repo.main, "squeal.config.json"), "{}\n");
    expect(readStatus(h.root)).toMatchObject({ runtimeFiles: { pending: true } });
    expect(formatWhy(readWhy(h.root, `${A} > runtime reader`))).toContain(
      "classification is unverified",
    );
  });
});
