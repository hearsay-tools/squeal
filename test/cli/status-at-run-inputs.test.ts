import { chmodSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { InstallResult } from "../../src/core/checkout/install.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import {
  type Fixture,
  fixture,
  git,
  link,
  linkInstall,
  ref,
  write,
} from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, run, testOf } from "./status-at-kit.js";

/*
 * Row 023-07, review wave-7 re-review B5 (the human, 2026-11-17, "Byte
 * check"): an install that changes a tracked input and hides it from `git
 * status` with `assume-unchanged` gives no result as the commit's. The
 * check compares the checkout's bytes, modes and link targets with the
 * commit's tree, whatever the index says: the file reads `not comparable
 * (install changed <path>)`, nothing runs and nothing is stored.
 */

const TEST = ref("test/a.test.ts");
const RUN = { allMissing: false, timeoutSeconds: 600 } as const;

const atOf = (out: string, path: string) =>
  (JSON.parse(out).files as { path: string; at: { state: string; reason?: string } }[]).find(
    (f) => f.path === path,
  )?.at;

/** Base commits `files` and a test asserting `value === 1`; HEAD changes the test's source. */
function base(files: Readonly<Record<string, string>>, source: string): { f: Fixture; a: string } {
  const f = fixture({ "squeal.config.json": "{}\n", ...files, [TEST.path]: testOf(source, 1) });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ [`src/${source}.ts`]: "export const value = 3;\n" });
  return { f, a };
}

/** An install that links Vitest, then `change`s the tree and hides `path` from `git status`. */
const hiding =
  (path: string, change: (tree: AbsolutePath) => void) => async (tree: AbsolutePath) => {
    link(tree);
    change(tree);
    git(tree, "update-index", "--assume-unchanged", path);
    return { ok: true, command: "link", ms: 0 } as const;
  };

/** `--run` with `install`, then a plain `--at` with an honest install: nothing ran, nothing was stored. */
async function refused(
  f: Fixture,
  a: string,
  install: (tree: AbsolutePath) => Promise<InstallResult>,
  path: string,
) {
  const ran = await run(
    f,
    { commit: a, json: true, run: RUN },
    { cacheRoot: f.cacheRoot, install },
  );
  expect(atOf(ran.out, TEST.path)).toEqual({
    state: "not comparable",
    reason: `install changed ${path}`,
  });
  expect(JSON.parse(ran.out).run).toMatchObject({ selected: 0, ran: 0, stored: 0, gateMs: null });
  expect(JSON.parse(ran.out).inputCheckMs).toEqual(expect.any(Number));
  const plain = await run(
    f,
    { commit: a, json: true },
    { cacheRoot: f.cacheRoot, install: linkInstall().install },
  );
  expect(atOf(plain.out, TEST.path)?.state).toBe("no result");
  clean(f);
}

describe(
  "status --at --run checks its inputs' bytes against the commit (row 023-07, re-review B5)",
  SLOW,
  () => {
    it("refuses a tracked source rewritten and hidden with assume-unchanged", async () => {
      const { f, a } = base({ "src/a.ts": "export const value = 2;\n" }, "a");
      const install = hiding("src/a.ts", (tree) =>
        write(tree, { "src/a.ts": "export const value = 1;\n" }),
      );
      expect(git(f.root, "status", "--porcelain")).toBe("");
      await refused(f, a, install, "src/a.ts");
    });

    it("refuses a mode the install changed and hid", async () => {
      const { f, a } = base({ "src/a.ts": "export const value = 1;\n" }, "a");
      const install = hiding("src/a.ts", (tree) => chmodSync(join(tree, "src/a.ts"), 0o755));
      await refused(f, a, install, "src/a.ts");
    });

    it("refuses a symlink the install retargeted and hid", async () => {
      // The commit's `src/value.ts` is a link to `one.ts`; HEAD makes it a file; the install points it at `two.ts`.
      const f = fixture({
        "squeal.config.json": "{}\n",
        "src/one.ts": "export const value = 2;\n",
        "src/two.ts": "export const value = 1;\n",
        [TEST.path]: testOf("value", 1),
      });
      symlinkSync("one.ts", join(f.root, "src/value.ts"));
      const linked = f.commit({});
      f.commit({ "src/value.ts": null });
      f.commit({ "src/value.ts": "export const value = 3;\n" });
      const install = hiding("src/value.ts", (tree) => {
        rmSync(join(tree, "src/value.ts"));
        symlinkSync("two.ts", join(tree, "src/value.ts"));
      });
      await refused(f, linked, install, "src/value.ts");
    });

    it("runs and stores as before when the install leaves every input as the commit has it", async () => {
      const { f, a } = base({ "src/a.ts": "export const value = 1;\n" }, "a");
      const ran = await run(
        f,
        { commit: a, json: true, run: RUN },
        { cacheRoot: f.cacheRoot, install: linkInstall().install },
      );
      expect(atOf(ran.out, TEST.path)?.state).toBe("pass");
      expect(JSON.parse(ran.out).run).toMatchObject({ selected: 1, ran: 1, stored: 1 });
      clean(f);
    });
  },
);
