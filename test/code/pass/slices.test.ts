import { DatabaseSync } from "node:sqlite";
import { setImmediate as nextTurn } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { Counter } from "../../../src/core/code/pass/index.js";
import { codeStorePath } from "../../../src/core/code/store/index.js";
import { HOOK_TIMEOUT_MS } from "../../../src/core/types/store-records.js";
import { open } from "../helpers.js";
import { fakeCounter, pass, policyOn, worktree } from "./helpers.js";

/** The fake counter with about the real one's CPU per file (2 to 4 ms, `complexity-and-crap.md`). */
function busyCounter(): Counter {
  const inner = fakeCounter();
  return {
    version: inner.version,
    count(text, language) {
      const end = performance.now() + 3;
      while (performance.now() < end);
      return inner.count(text, language);
    },
  };
}

describe("a pull of 300 files (015 D4)", () => {
  it("counts in slices of 200 and leaves the code store writable between every turn", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    const files = Array.from({ length: 300 }, (_, i) => `src/m${i}.ts`);
    for (const [i, path] of files.entries()) tree.write(path, `f${i} 3 A${i}\n`);
    tree.revise();
    await pass(tree, store, fakeCounter());
    for (const [i, path] of files.entries()) tree.write(path, `f${i} 3 B${i}\nh${i} 25 C${i}\n`);
    tree.revise();

    // A hook's connection: no busy wait, so a lock the pass held across a turn would fail it.
    const hook = new DatabaseSync(codeStorePath(tree.commonDir));
    hook.exec("PRAGMA busy_timeout = 0; PRAGMA synchronous = NORMAL");
    const seen = new Set<number>();
    let longest = 0;
    let writes = 0;
    let done = false;
    const probe = (async () => {
      let last = performance.now();
      while (!done) {
        await nextTurn();
        const now = performance.now();
        longest = Math.max(longest, now - last);
        last = now;
        hook.exec("BEGIN IMMEDIATE");
        hook
          .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('hook', ?)")
          .run(String(now));
        hook.exec("COMMIT");
        writes++;
        seen.add(Number(hook.prepare("SELECT count(*) AS n FROM counts").get()?.n));
      }
    })();
    const report = await pass(tree, store, busyCounter());
    done = true;
    await probe;
    hook.close();

    expect(report).toMatchObject({ mode: "edit", files: 300, counted: 300, transitions: 300 });
    // 300 counts stored before; the first slice adds 200, the second the last 100.
    expect([...seen].filter((n) => n > 300 && n < 600)).toEqual([500]);
    expect(writes).toBeGreaterThan(2);
    expect(longest).toBeLessThan(HOOK_TIMEOUT_MS);
  });

  // Row 015-48: a recount whose counts are all stored still reads and parses each one to know it.
  it("looks up stored counts a slice at a time, a turn apart", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    for (let i = 0; i < 12; i++) tree.write(`src/m${i}.ts`, `f${i} 3 A${i}\n`);
    tree.revise();
    await pass(tree, store, fakeCounter());
    /** The turns a threshold recount gives with `sliceFiles`. */
    const turns = async (threshold: number, sliceFiles: number) => {
      let given = 0;
      let done = false;
      const probe = (async () => {
        while (!done) {
          await nextTurn();
          given++;
        }
      })();
      const report = await pass(tree, store, fakeCounter(), {
        policy: policyOn({ threshold }),
        sliceFiles,
      });
      done = true;
      await probe;
      expect(report).toMatchObject({ mode: "threshold", counted: 0 });
      return given;
    };

    const whole = await turns(2, 12);
    // Three slices of 4: two turns more.
    expect(await turns(3, 4)).toBe(whole + 2);
  });
});
