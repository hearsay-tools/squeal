import { describe, expect, it } from "vitest";
import type { AtDaemons } from "../../src/cli/status-at-daemons.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { PAYLOAD_SCHEMA_VERSION } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { check, clean, run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-07, done-when; spec 023 D4: `squeal status --at <commit> --run`
 * on `$TMPDIR` git fixtures with the real Vitest adapter. Coverage is on,
 * as by default, so the gate keeps what it runs in the shared stores
 * (020 D17.3) at the keys the keying gives at the commit. Row 023-40:
 * the files run in the commit daemon, here a stand-in; row 023-40c: the
 * daemon selects them, and the call reads its rows.
 */

const TEST = ref("test/a.test.ts");
const PLAIN = ref("test/plain.test.ts");
const ON = { "squeal.config.json": "{}\n" };

/** Commit A: `a.test.ts` and `plain.test.ts` pass; HEAD changes `src/a.ts` and its test. */
function changed() {
  const f = fixture({
    ...ON,
    "src/a.ts": "export const value = 1;\n",
    [TEST.path]: testOf("a", 1),
    "src/plain.ts": "export const value = 1;\n",
    [PLAIN.path]: testOf("plain", 1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: testOf("a", 2) });
  return { f, a };
}

const fileOf = (out: string, path: string) =>
  (
    JSON.parse(out).files as {
      path: string;
      at: { state: string; key?: string; origin?: { kind: string } };
    }[]
  ).find((file) => file.path === path);

/** The stand-in commit daemon's rows: each file at `commit-<path>`, queued or done. */
function rows(f: Fixture, tree: string, files: readonly TestFileRef[], queued: boolean): void {
  withStore(f, (store) =>
    store.testFileKeys.upsertMany(
      files.map((testFile) => ({
        worktreeId: worktreeIdFor(tree as AbsolutePath),
        testFile,
        key: `commit-${testFile.path}`,
        revision: 2,
        pending: queued ? ("queued" as const) : null,
      })),
    ),
  );
}

describe("squeal status --at --run (row 023-07, D4; row 023-40, D7.3; row 023-40c)", SLOW, () => {
  it("asks the commit daemon, which queues what the change selects; the call installs and keys nothing", async () => {
    const { f, a } = changed();
    const install = linkInstall();
    const tree = standInTree(f);
    // The commit daemon lists both files; the change selects TEST, which it runs while the call waits.
    rows(f, tree, [TEST, PLAIN], false);
    const daemons = standIn(
      tree,
      (root, files) => {
        if (root !== tree) return;
        withStore(f, (store) =>
          store.results.putMany(
            files.map((file) =>
              result(check(file.path), `commit-${file.path}`, { worktreeId: worktreeIdFor(tree) }),
            ),
          ),
        );
        rows(f, tree, files, false);
      },
      { select: () => [TEST], rows: (at, files) => rows(f, at, files, true) },
    );
    const options = { cacheRoot: f.cacheRoot, install: install.install, daemons: daemons.ports };

    const first = await run(f, { commit: a, json: true, run: { allMissing: false } }, options);
    expect(fileOf(first.out, TEST.path)?.at).toMatchObject({
      state: "pass",
      origin: { kind: "commit" },
    });
    // Not selected: the diff A..HEAD touches nothing it loads; nothing queued it.
    expect(fileOf(first.out, PLAIN.path)?.at).toMatchObject({ state: "no result" });
    expect(daemons.commitAsks).toEqual([
      expect.objectContaining({ named: [], changed: expect.arrayContaining(["src/a.ts"]) }),
    ]);
    expect(JSON.parse(first.out).run).toMatchObject({
      mode: "queue",
      commit: { files: 1, known: 1, running: 0 },
      notSelected: 1,
    });
    // D7.3 as amended: no checkout, no install, no keying in the call.
    expect(install.calls()).toBe(0);
    clean(f);
  });

  it("reads a failed commit setup as its text, not as running", async () => {
    const { f, a } = changed();
    const tree = standInTree(f);
    const stand = standIn(tree, () => undefined);
    const text = "install: npm ci: exit 1";
    const daemons: AtDaemons = {
      ...stand.ports,
      commitRead: async () => ({
        schemaVersion: PAYLOAD_SCHEMA_VERSION,
        ok: true as const,
        type: "commit-read" as const,
        setup: { phase: "failed" as const, text },
        asks: [],
      }),
    };
    const failed = await run(
      f,
      { commit: a, paths: [TEST.path], run: { allMissing: false }, waitMs: 5000 },
      { cacheRoot: f.cacheRoot, install: linkInstall().install, daemons },
    );
    expect(failed.code).toBe(3);
    expect(failed.out).toContain(`${TEST.path}: not run (the batch's setup failed: ${text})`);
    expect(failed.out).not.toContain("still running");
    expect(failed.out).not.toContain("still setting up");
    clean(f);
  });

  it("--all-missing asks for every file with no result and tells the estimate of what it queued", async () => {
    const { f, a } = changed();
    const tree = standInTree(f);
    const daemons = standIn(tree, () => undefined, {
      select: (ask) => (ask.allMissing ? [TEST, PLAIN] : []),
      rows: (at, files) => rows(f, at, files, true),
    });
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: daemons.ports,
    };

    const all = await run(f, { commit: a, run: { allMissing: true }, waitMs: 3000 }, options);
    const at = a.slice(0, 9);
    expect(daemons.commitAsks).toEqual([expect.objectContaining({ allMissing: true })]);
    expect(all.err).toMatch(
      new RegExp(
        `squeal: --all-missing: 2 test files with no result at ${at} queued in its commit daemon, up to \\d+ at once: no stored duration, so the time is unknown; they run on after the wait\n`,
      ),
    );
    expect(all.out).toContain(
      `--run: queued 2 test files with no result at ${at} in its commit daemon`,
    );
    clean(f);
  });
});
