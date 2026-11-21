import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fixture, git, link, linkInstall, ref, write } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { check, clean, run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-07, done-when; spec 023 D4: `squeal status --at <commit> --run`
 * on `$TMPDIR` git fixtures with the real Vitest adapter. Coverage is on,
 * as by default, so the gate keeps what it runs in the shared stores
 * (020 D17.3) at the keys the keying gives at the commit. Row 023-40:
 * the files run in the commit daemon, here a stand-in.
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

describe("squeal status --at --run (row 023-07, D4; row 023-40, D7.3)", SLOW, () => {
  it("queues the file the diff selects in the commit daemon; the next --at reads what it stored", async () => {
    const { f, a } = changed();
    const install = linkInstall();
    const options = { cacheRoot: f.cacheRoot, install: install.install };
    const key = fileOf((await run(f, { commit: a, json: true }, options)).out, TEST.path)?.at
      .key as string;
    const tree = standInTree(f);
    // The commit daemon runs it and stores it at the commit's key while the call waits.
    const daemons = standIn(tree, (root, files) => {
      if (root !== tree) return;
      withStore(f, (store) =>
        store.results.putMany(
          files.map((file) => result(check(file.path), key, { worktreeId: worktreeIdFor(tree) })),
        ),
      );
    });

    const first = await run(
      f,
      { commit: a, json: true, run: { allMissing: false } },
      { ...options, daemons: daemons.ports },
    );
    expect(fileOf(first.out, TEST.path)?.at).toMatchObject({
      state: "pass",
      origin: { kind: "commit" },
    });
    // Not selected: the diff A..HEAD touches nothing it loads; nothing queued it.
    expect(fileOf(first.out, PLAIN.path)?.at).toMatchObject({ state: "no result" });
    expect(daemons.asks.filter((ask) => ask.root === tree).map((ask) => ask.paths)).toEqual([
      [TEST.path],
    ]);
    expect(JSON.parse(first.out).run).toMatchObject({
      mode: "queue",
      commit: { files: 1, known: 1, running: 0 },
      notSelected: 1,
    });
    // Two checkouts, two installs: the keying's, once per call; nothing ran in them.
    expect(install.calls()).toBe(2);
    clean(f);

    const second = await run(f, { commit: a, json: true }, options);
    expect(fileOf(second.out, TEST.path)?.at).toMatchObject({ state: "pass" });
    expect(JSON.parse(second.out).run).toBeNull();

    const third = await run(f, { commit: a, run: { allMissing: false } }, options);
    // Row 023-29 (R8): the unselected file has no result there; the count says so.
    expect(third.out).toContain(
      `--run: no file with no result at ${a.slice(0, 9)} that the change selects to run`,
    );
    clean(f);
  });

  it("queues nothing when the checkout gives no keys, and says why", async () => {
    const { f, a } = changed();
    const daemons = standIn(standInTree(f), () => undefined);
    const failed = await run(
      f,
      { commit: a, run: { allMissing: false } },
      {
        cacheRoot: f.cacheRoot,
        install: async () => ({ ok: false, command: "npm ci", ms: 1, reason: "exit 1", log: "" }),
        daemons: daemons.ports,
      },
    );
    expect(failed.code).toBe(3);
    expect(failed.out).toContain("The checkout gave no keys: install: npm ci: exit 1");
    expect(failed.out).not.toContain("--run:");
    expect(daemons.commits).toEqual([]);
    expect(daemons.asks.filter((ask) => ask.root !== f.root)).toEqual([]);
    clean(f);
  });

  it("--all-missing prints the estimate first, queues every file with no result, and refuses one that needs an untracked path", async () => {
    const GEN = ref("test/gen.test.ts");
    const BAD = ref("test/bad.test.ts");
    const { f } = changed();
    f.commit({
      ".gitignore": "node_modules/\nsrc/gen.ts\n",
      [GEN.path]: testOf("gen", 1),
      [BAD.path]: testOf("plain", 2),
    });
    const b = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/plain.ts": "export const value = 1; // c\n" });
    // The install writes a source git does not hold, which `gen.test.ts` loads (D4.9).
    const install = async (tree: AbsolutePath) => {
      link(tree);
      write(tree, { "src/gen.ts": "export const value = 1;\n" });
      return { ok: true, command: "link", ms: 0 } as const;
    };
    const tree = standInTree(f);
    const daemons = standIn(tree, () => undefined);
    const options = { cacheRoot: f.cacheRoot, install, daemons: daemons.ports };

    const all = await run(f, { commit: b, run: { allMissing: true } }, options);
    const at = b.slice(0, 9);
    expect(all.err).toMatch(
      new RegExp(
        `squeal: --all-missing: 3 test files with no result at ${at} queued in its commit daemon, up to \\d+ at once: no stored duration, so the time is unknown; they run on after the wait\n`,
      ),
    );
    expect(all.out).toContain(`${GEN.path}: not comparable (needs src/gen.ts) -> `);
    const queued = daemons.asks.filter((ask) => ask.root === tree).flatMap((ask) => ask.paths);
    expect([...queued].sort()).toEqual([BAD.path, TEST.path, PLAIN.path].sort());
    expect(all.out).toContain(
      `--run: queued 3 test files with no result at ${at} in its commit daemon`,
    );
    clean(f);
  });
});
