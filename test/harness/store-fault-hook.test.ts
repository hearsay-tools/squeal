import { chmodSync, existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readStoreMark } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import type { HookResult } from "../../src/harness/claude-code/run.js";
import { type HookDeps, withContext } from "../../src/harness/shared/hook.js";
import { damageHeader, damageOverflow, seedOverflow } from "../store/damage.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 011-391: a hook that meets a damaged store (its open, or a read that
 * throws corruption) marks it, found by `hook`, so every daemon on it stops
 * and the next start moves it aside. The hook moves nothing and prints
 * nothing, and a store it cannot mark changes neither.
 */

const SILENT: HookResult = { stdout: "", stderr: "", exitCode: 0 };
const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
// Root writes into a read-only directory, so that case runs only for other users.
const IS_ROOT = process.getuid?.() === 0;

const location = (r: SquealRepo) => ({ root: r.root, commonDir: r.repo.commonDir });

/** The store's directory, its files left where they were. */
function storeFiles(r: SquealRepo): string[] {
  return readdirSync(storePaths(r.repo.commonDir).dir).filter((name) => name.includes("corrupt"));
}

/** A hook whose read of `big` hits damaged pages; resolves to what it threw. */
async function readDamaged(r: SquealRepo): Promise<unknown> {
  try {
    await withContext({ session_id: "s1" }, location(r), deps, async (context) => {
      context.store.meta.get("big");
      return null;
    });
  } catch (error) {
    return error;
  }
  return null;
}

/** Runs `fn` with the store's directory read-only, writable again after. */
async function readOnly<T>(r: SquealRepo, fn: () => Promise<T>): Promise<T> {
  const { dir } = storePaths(r.repo.commonDir);
  chmodSync(dir, 0o555);
  try {
    return await fn();
  } finally {
    chmodSync(dir, 0o755);
  }
}

describe("a hook on a damaged store (row 011-391)", () => {
  it("marks a store whose open fails with corruption, prints nothing and moves nothing", async () => {
    const r = squealRepo();
    damageHeader(r.repo.commonDir);

    const out = await runHook("pre-tool-use", recorded("pre-tool-use", r.root), deps);

    expect(out).toEqual(SILENT);
    expect(readStoreMark(r.repo.commonDir)).toMatchObject({
      found: "hook",
      problem: expect.stringContaining("did not open"),
    });
    expect(existsSync(storePaths(r.repo.commonDir).database)).toBe(true);
    expect(storeFiles(r)).toEqual([]);
  });

  it("marks a store a read hit damage in, and the error stays the hook's", async () => {
    const r = squealRepo();
    seedOverflow(r.repo.commonDir, "big");
    damageOverflow(r.repo.commonDir);

    const thrown = await readDamaged(r);

    expect(thrown).toMatchObject({ errcode: 11 });
    expect(readStoreMark(r.repo.commonDir)).toMatchObject({
      found: "hook",
      problem: expect.stringMatching(/malformed|corrupt/),
    });
    expect(storeFiles(r)).toEqual([]);
  });

  it("keeps a mark already there", async () => {
    const r = squealRepo();
    seedOverflow(r.repo.commonDir, "big");
    damageOverflow(r.repo.commonDir);
    await readDamaged(r);
    const first = readStoreMark(r.repo.commonDir);

    await readDamaged(r);
    expect(readStoreMark(r.repo.commonDir)).toEqual(first);
  });

  it.skipIf(IS_ROOT)("never throws or prints when it cannot write the mark", async () => {
    const r = squealRepo();
    seedOverflow(r.repo.commonDir, "big");
    damageOverflow(r.repo.commonDir);
    const thrown = await readOnly(r, () => readDamaged(r));
    expect(thrown).toMatchObject({ errcode: 11 });
    expect(readStoreMark(r.repo.commonDir)).toBeNull();

    damageHeader(r.repo.commonDir);
    const out = await readOnly(r, () =>
      runHook("pre-tool-use", recorded("pre-tool-use", r.root), deps),
    );
    expect(out).toEqual(SILENT);
    expect(readStoreMark(r.repo.commonDir)).toBeNull();
  });
});
