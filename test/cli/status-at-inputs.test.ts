import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
import { onCleanUp, SLOW } from "../scheduler/cleanup.js";
import { clean, run, testOf } from "./status-at-kit.js";

/*
 * Row 023-07: the whole-checkout check (the human, 2026-11-17, after
 * reviews wave-7, wave-7-rereview and wave-7-third B5). After the install,
 * every path the commit tracks is compared with the commit's tree: bytes,
 * mode and link target, whatever the index says. When the install changed
 * any of them, the commit side is `not comparable` with the change named.
 * Row 023-41: the in-call run these tests also drove is gone (D7.3); the
 * keying's check stays, and plain `--at` shows it.
 */

const TEST = ref("test/a.test.ts");

interface At {
  state: string;
  reason?: string;
}
const atOf = (out: string) =>
  (JSON.parse(out).files as { path: string; at: At }[]).find((f) => f.path === TEST.path)?.at;

const options = (f: Fixture, install: (tree: AbsolutePath) => Promise<InstallResult>) => ({
  cacheRoot: f.cacheRoot,
  install,
});

/** Base commits `files` and a test asserting `value === 1`; HEAD changes the test. */
function based(files: Readonly<Record<string, string>>, source: string): { f: Fixture; a: string } {
  const f = fixture({ "squeal.config.json": "{}\n", ...files, [TEST.path]: testOf(source, 1) });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ [TEST.path]: `${testOf(source, 1)}// HEAD\n` });
  return { f, a };
}

/** An install that links Vitest and `change`s the tree, then hides `hide` from `git status`. */
const altering =
  (change: (tree: AbsolutePath) => void, hide?: string) =>
  async (tree: AbsolutePath): Promise<InstallResult> => {
    link(tree);
    change(tree);
    if (hide !== undefined) git(tree, "update-index", "--assume-unchanged", hide);
    return { ok: true, command: "link", ms: 0 };
  };

/**
 * A plain `--at` with `install` gives no result as the commit's, with the
 * changed path named; one with an honest install finds none stored.
 */
async function shownNotComparable(
  f: Fixture,
  a: string,
  install: (tree: AbsolutePath) => Promise<InstallResult>,
  path: string,
): Promise<void> {
  const reason = `install changed the checkout: ${path}`;
  const altered = await run(f, { commit: a, json: true }, options(f, install));
  expect(atOf(altered.out)).toEqual({ state: "not comparable", reason });
  const honest = await run(f, { commit: a, json: true }, options(f, linkInstall().install));
  expect(atOf(honest.out)?.state).toBe("no result");
  clean(f);
}

/** The third review's fixture: `src/value.ts` links to `one.ts` (2); `two.ts` and `value/index.ts` give 1. */
function linked(): { f: Fixture; a: string } {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/one.ts": "export const value = 2;\n",
    "src/two.ts": "export const value = 1;\n",
    "src/value/index.ts": "export const value = 1;\n",
    [TEST.path]: testOf("value", 1),
  });
  symlinkSync("one.ts", join(f.root, "src/value.ts"));
  const a = f.commit({});
  f.commit({ [TEST.path]: `${testOf("value", 1)}// HEAD\n` });
  return { f, a };
}

const relink = (tree: AbsolutePath, target: string) => {
  rmSync(join(tree, "src/value.ts"));
  symlinkSync(target, join(tree, "src/value.ts"));
};

describe("status --at: the whole-checkout check (row 023-07)", SLOW, () => {
  it("is not comparable after an install that rewrites a tracked file", async () => {
    const { f, a } = based({ "src/a.ts": "export const value = 2;\n" }, "a");
    const install = altering((tree) => write(tree, { "src/a.ts": "export const value = 1;\n" }));
    await shownNotComparable(f, a, install, "src/a.ts");
  });

  it("finds a rewrite, a mode and an internal link change hidden with assume-unchanged", async () => {
    const rewrite = based({ "src/a.ts": "export const value = 2;\n" }, "a");
    await shownNotComparable(
      rewrite.f,
      rewrite.a,
      altering((tree) => write(tree, { "src/a.ts": "export const value = 1;\n" }), "src/a.ts"),
      "src/a.ts",
    );
    const mode = based({ "src/a.ts": "export const value = 1;\n" }, "a");
    await shownNotComparable(
      mode.f,
      mode.a,
      altering((tree) => chmodSync(join(tree, "src/a.ts"), 0o755), "src/a.ts"),
      "src/a.ts",
    );
    const internal = linked();
    await shownNotComparable(
      internal.f,
      internal.a,
      altering((tree) => relink(tree, "two.ts"), "src/value.ts"),
      "src/value.ts",
    );
  });

  it("finds a hidden link retargeted outside the tree, and a hidden deleted link (third review B5)", async () => {
    const outside = mkdtempSync(join(tmpdir(), "sq-at-outside-"));
    onCleanUp(() => rmSync(outside, { recursive: true, force: true }));
    writeFileSync(join(outside, "value.ts"), "export const value = 1;\n");
    const away = linked();
    await shownNotComparable(
      away.f,
      away.a,
      altering((tree) => relink(tree, join(outside, "value.ts")), "src/value.ts"),
      "src/value.ts",
    );

    const gone = linked();
    await shownNotComparable(
      gone.f,
      gone.a,
      altering((tree) => rmSync(join(tree, "src/value.ts")), "src/value.ts"),
      "src/value.ts",
    );
  });
});
