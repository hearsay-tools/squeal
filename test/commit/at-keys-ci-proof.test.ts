import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keysAtCommit } from "../../src/core/commit/at-keys.js";
import type { KeyAt } from "../../src/core/commit/at-keys-checkout.js";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { SLOW } from "../scheduler/cleanup.js";
import { ciExportAt, publishLocal, recordHere, withRemote } from "./at-keys-ci-fixture.js";
import { type Fixture, fixture, git, keying, linkInstall, ref } from "./at-keys-fixture.js";

/*
 * Row 023-17, review wave-6 B1, B2 and B3, each probe of the review as a
 * regression test: a CI key stands only when it is the key the checkout
 * at the commit gives now (`ci: false` is the reference), and only an
 * export CI recorded gives origin `ci`.
 */

const TEST = ref("test/a.test.ts");
const VARIABLE = "SQUEAL_REVIEW_MODE";

const FILES = {
  "src/a.ts": "export const value = 1;\n",
  "data.txt": "data\n",
  [TEST.path]: [
    'import { expect, it } from "vitest";',
    'import { value } from "../src/a";',
    'it("value", () => expect(value).toBe(1));',
    "",
  ].join("\n"),
};

const keyOf = (at: KeyAt | undefined) => (at !== undefined && "key" in at ? at.key : "");
const storedOf = (at: KeyAt | undefined) => (at !== undefined && "stored" in at ? at.stored : []);

/** Commit `a` with FILES, then `b` changing `src/a.ts`, pushed to a remote; the worktree's environment recorded. */
async function twoCommits(extra: Record<string, string> = {}): Promise<{ f: Fixture; a: string }> {
  const f = fixture({ ...FILES, ...extra });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n" });
  withRemote(f);
  await recordHere(f);
  return { f, a };
}

/** Sets the repository store's shared `observed` rows, as another run's record would. */
function observeHere(f: Fixture, rows: Record<string, string[]>): void {
  const store = openStore(join(f.root, ".git") as AbsolutePath);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  try {
    store.meta.set(observedMetaKey(""), JSON.stringify(rows));
  } finally {
    store.close();
  }
}

/** The key and CI count with the CI step on, and the checkout's key with it off. */
async function bothWays(f: Fixture, a: string, env: NodeJS.ProcessEnv = process.env) {
  const install = linkInstall();
  const options = { ...keying(f, install.install), env, root: f.root, commit: a, files: [TEST] };
  const on = await keysAtCommit(options);
  const calls = install.calls();
  const off = await keysAtCommit({ ...options, ci: false });
  return { on, calls, off: keyOf(off.files.get(testFileId(TEST))) };
}

describe("a CI key stands only for the checkout's key now (review wave-6)", SLOW, () => {
  it("B1: an observed input another run recorded sends the file to the checkout", async () => {
    const { f, a } = await twoCommits();
    publishLocal(f.root, a, await ciExportAt(f, a, [TEST]));
    observeHere(f, { [TEST.path]: ["data.txt"] });
    const { on, calls, off } = await bothWays(f, a);
    expect(on.ci).toMatchObject({ settled: 0 });
    expect(calls).toBe(1);
    expect(keyOf(on.files.get(testFileId(TEST)))).toBe(off);
    expect(storedOf(on.files.get(testFileId(TEST)))).toEqual([]);
  });

  it("B1: with the export's own observed rows in the store, CI's key is the checkout's", async () => {
    const { f, a } = await twoCommits();
    const rows = { [TEST.path]: ["data.txt"] };
    publishLocal(f.root, a, await ciExportAt(f, a, [TEST], rows));
    observeHere(f, rows);
    const { on, calls, off } = await bothWays(f, a);
    expect(on.ci).toMatchObject({ settled: 1 });
    expect(calls).toBe(0);
    expect(keyOf(on.files.get(testFileId(TEST)))).toBe(off);
    expect(storedOf(on.files.get(testFileId(TEST))).map((r) => r.origin)).toEqual(["ci"]);
  });

  it("B2: an allow-listed variable changed since the record sends the file to the checkout", async () => {
    const config = { coverage: { enabled: false }, env: { allowlist: [VARIABLE] } };
    const { [VARIABLE]: _, ...unset } = process.env;
    expect(process.env[VARIABLE]).toBeUndefined();
    const { f, a } = await twoCommits({ "squeal.config.json": `${JSON.stringify(config)}\n` });
    publishLocal(f.root, a, await ciExportAt(f, a, [TEST]));
    // No daemon updates the record: the call's variables alone differ.
    const changed = await bothWays(f, a, { ...unset, [VARIABLE]: "changed" });
    expect(changed.on.ci).toMatchObject({ settled: 0 });
    expect(changed.calls).toBe(1);
    expect(keyOf(changed.on.files.get(testFileId(TEST)))).toBe(changed.off);
    // The same variables as the record: CI settles it, at the checkout's key.
    const same = await bothWays(f, a, unset);
    expect(same.on.ci).toMatchObject({ settled: 1 });
    expect(same.calls).toBe(0);
    expect(keyOf(same.on.files.get(testFileId(TEST)))).toBe(same.off);
    expect(same.off).not.toBe(changed.off);
  });

  it("B3: a local export at the results ref is not CI's: the checkout keys the file", async () => {
    const { f, a } = await twoCommits();
    const bundle = await ciExportAt(f, a, [TEST]);
    publishLocal(f.root, a, { ...bundle, header: { ...bundle.header, source: { kind: "local" } } });
    const { on, calls, off } = await bothWays(f, a);
    expect(on.ci).toEqual({
      source: null,
      settled: 0,
      missed: `refs/squeal/${a}: local export at ${a.slice(0, 8)}, not CI's`,
    });
    expect(calls).toBe(1);
    expect(keyOf(on.files.get(testFileId(TEST)))).toBe(off);
    expect(storedOf(on.files.get(testFileId(TEST))).some((r) => r.origin === "ci")).toBe(false);
  });
});
