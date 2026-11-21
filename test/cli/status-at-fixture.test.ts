import { realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { type Fixture, fixture, freshKey, git, passesAt, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { check, clean, run, testCheck, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-06, done-when: `squeal status --at` on `$TMPDIR` git fixtures with
 * the real Vitest adapter (`daemonAdapters`): each per-file state, the
 * comparison lines, a daemon and a no-daemon current side, the 7-day line,
 * JSON, and the commit before a fix reporting the fixed test `fail -> pass`.
 */

const TEST = ref("test/a.test.ts");
const PLAIN = ref("test/plain.test.ts");
const NEW = ref("test/new.test.ts");

/** A test of `src/a.ts` that fails at the first commit and passes after the fix commit. */
function fixed(): { f: Fixture; before: string; after: string } {
  const f = fixture({
    "src/plain.ts": "export const value = 1;\n",
    [PLAIN.path]: testOf("plain", 1),
    "src/a.ts": "export const value = 1;\n",
    [TEST.path]: testOf("a", 2),
  });
  const before = git(f.root, "rev-parse", "HEAD").trim();
  const after = f.commit({
    "src/a.ts": "export const value = 2;\n",
    [NEW.path]: testOf("plain", 1),
  });
  return { f, before, after };
}

describe("squeal status --at on a git fixture (row 023-06)", SLOW, () => {
  it("reports the commit before a fix fail -> pass, with no daemon, in text and JSON", async () => {
    const { f, before, after } = fixed();
    expect(passesAt(f, before, TEST)).toBe(false);
    expect(passesAt(f, after, TEST)).toBe(true);
    const keys = {
      failBefore: await freshKey(f, before, TEST),
      passAfter: await freshKey(f, after, TEST),
      plainBefore: await freshKey(f, before, PLAIN),
      plainAfter: await freshKey(f, after, PLAIN),
    };
    expect(keys.failBefore).not.toBe(keys.passAfter);
    withStore(f, (store) =>
      store.results.putMany([
        result(testCheck(TEST.path), keys.failBefore, { outcome: "fail" }),
        result(check(TEST.path), keys.passAfter, { worktreeId: worktreeIdFor(f.root) }),
        result(check(PLAIN.path), keys.plainBefore),
        ...(keys.plainAfter === keys.plainBefore
          ? []
          : [result(check(PLAIN.path), keys.plainAfter)]),
      ]),
    );

    const text = await run(f, { commit: before });
    expect(text.code).toBe(3);
    const at = before.slice(0, 9);
    expect(text.out).toContain(
      "No daemon runs in this worktree: now is the stored results at the working tree's keys.",
    );
    expect(text.out).toContain(
      `test/a.test.ts: fail -> pass (at ${at}: value; run in worktree wt-main; now: run in this worktree)`,
    );
    expect(text.out).toContain(`${NEW.path}: absent -> no result`);
    expect(text.out).not.toContain(PLAIN.path);
    expect(text.out).toContain("0 pass -> fail, 1 fail -> pass, 1 unchanged, 1 unknown");
    expect(text.err).toContain(`keying test files at ${at} in a temporary checkout`);

    const json = await run(f, { commit: before, paths: [TEST.path], json: true });
    expect(json.code).toBe(0);
    const value = JSON.parse(json.out);
    expect(value).toMatchObject({
      version: "squeal-status-at/2",
      commit: before,
      head: after,
      dirty: false,
      now: { kind: "stored" },
      failure: null,
      counts: { "fail -> pass": 1, "pass -> fail": 0, unchanged: 0, unknown: 0 },
    });
    expect(value.checkoutMs).toBeGreaterThan(0);
    expect(value.files).toEqual([
      {
        project: "",
        path: TEST.path,
        change: "fail -> pass",
        at: expect.objectContaining({ state: "fail", key: keys.failBefore, failed: ["value"] }),
        now: expect.objectContaining({ state: "pass", key: keys.passAfter }),
      },
    ]);
    expect(json.err).toBe("");
    clean(f);
  });

  it("reads now from a live daemon's keys and states, with no keying here", async () => {
    const { f, before } = fixed();
    const passBefore = await freshKey(f, before, TEST);
    const id = worktreeIdFor(f.root);
    withStore(f, (store) => {
      store.worktrees.upsert({
        id,
        root: f.root,
        commonDir: realpathSync(join(f.root, ".git")) as AbsolutePath,
        isMain: true,
        registeredAt: 1,
        daemon: {
          socketPath: join(f.dir, "d.sock") as AbsolutePath,
          startedAt: Date.now(),
          heartbeatAt: Date.now(),
          heartbeatIntervalMs: 60_000,
          squealVersion: "0.0.0",
        },
      });
      // Keys no keyer gives: the answer can only come from the daemon's rows.
      store.testFileKeys.upsertMany([
        { worktreeId: id, testFile: TEST, key: "daemon-key-a", revision: 7, pending: null },
        {
          worktreeId: id,
          testFile: PLAIN,
          key: "daemon-key-plain",
          revision: 6,
          pending: "queued",
        },
        { worktreeId: id, testFile: NEW, key: null, revision: 7, pending: null },
      ]);
      store.results.putMany([
        result(check(TEST.path), passBefore, { worktreeId: "other-worktree00" }),
        result(testCheck(TEST.path), "daemon-key-a", { outcome: "fail", worktreeId: id }),
      ]);
    });
    const { code, out } = await run(f, { commit: before });
    expect(code).toBe(3);
    const at = before.slice(0, 9);
    expect(out).toContain("Now is this worktree's daemon at revision 7.");
    expect(out).toContain(
      `test/a.test.ts: pass -> fail (at ${at}: run in worktree other-wo; now: value; run in this worktree)`,
    );
    expect(out).toContain(`${PLAIN.path}: no result -> no result (queued)`);
    expect(out).toContain(`${NEW.path}: absent -> not determined (the daemon has no key for it)`);
    expect(out).toContain("1 pass -> fail, 0 fail -> pass, 0 unchanged, 2 unknown");
    clean(f);
  });

  it("says results are kept 7 days, names a failed checkout, and refuses an unknown commit", async () => {
    const { f, before } = fixed();
    const tenDays = Date.now() + 10 * 86_400_000;
    const old = await run(f, { commit: before }, undefined, tenDays);
    expect(old.code).toBe(3);
    expect(old.out).toContain(`${TEST.path}: no result -> no result`);
    expect(old.out).toMatch(/Results are kept 7 days; [0-9a-f]{9} is 10 days old/);

    const install = async () =>
      ({ ok: false, command: "npm ci", ms: 1, reason: "exit 1", log: "" }) as const;
    const failed = await run(
      f,
      { commit: before, paths: ["test"] },
      { cacheRoot: f.cacheRoot, install },
    );
    expect(failed.code).toBe(3);
    expect(failed.out).toContain("The checkout gave no keys: install: npm ci: exit 1");
    expect(failed.out).toContain(
      `${TEST.path}: not determined (install: npm ci: exit 1) -> no result`,
    );
    expect(failed.out).not.toContain("kept 7 days");

    const unknown = await run(f, { commit: "no-such-commit" });
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('"no-such-commit" names no commit here');
    clean(f);
  });
});
