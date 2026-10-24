import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRecount } from "../../../src/core/code/pass/index.js";
import { codeStorePath } from "../../../src/core/code/store/index.js";
import { storePaths } from "../../../src/core/store/paths.js";
import type { CodeLanguage } from "../../../src/core/types/code.js";
import { DEFAULT_POLICY } from "../../../src/core/types/index.js";
import { waitFor } from "../../watcher/helpers.js";
import { open } from "../helpers.js";
import { daemonPass, fakeCounter, policyOn, worktree } from "./helpers.js";

describe("the daemon's code pass (015 D4, goal 1)", () => {
  it("counts nothing and creates no code store while the policy is off", async () => {
    const tree = worktree();
    tree.write("src/a.ts", "settle 23 B1\n").revise();
    const counter = fakeCounter();
    let loaded = 0;
    const { code, reports } = daemonPass(tree, {
      policy: () => DEFAULT_POLICY,
      counter: () => {
        loaded++;
        return Promise.resolve(counter);
      },
    });
    code.nudge();
    await code.idle();
    await code.close();
    expect(loaded).toBe(0);
    expect(counter.calls).toEqual([]);
    expect(reports).toEqual([]);
    expect(existsSync(codeStorePath(tree.commonDir))).toBe(false);
    expect(existsSync(storePaths(tree.commonDir).dir)).toBe(false);
  });

  it("makes a switch-on a first count with its recount key, over inherited counts too", async () => {
    const tree = worktree();
    tree.write("src/a.ts", "settle 23 B1\n").revise();
    let policy = policyOn();
    const { code, reports } = daemonPass(tree, { policy: () => policy });
    code.nudge();
    await code.idle();
    policy = DEFAULT_POLICY;
    tree.write("src/a.ts", "settle 30 B2\n").revise();
    code.nudge();
    await code.idle();
    policy = policyOn();
    tree.write("src/a.ts", "settle 23 B1\n").revise();
    code.nudge();
    await code.idle();
    await code.close();
    expect(reports.map((r) => `${r.mode} ${r.counted} ${r.transitions}`)).toEqual([
      "first 1 0",
      "first 0 0",
    ]);
    expect(readRecount(open(tree.commonDir).meta, tree.id)).toMatchObject({
      reason: "first",
      revision: 3,
    });
  });

  it("runs one more pass for nudges during a pass, never two at once", async () => {
    const tree = worktree();
    tree.write("src/a.ts", "settle 23 B1\n").revise();
    const inner = fakeCounter();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0;
    let most = 0;
    const counter = {
      version: inner.version,
      async count(text: string, language: CodeLanguage) {
        most = Math.max(most, ++active);
        await gate;
        active--;
        return inner.count(text, language);
      },
    };
    const { code, reports } = daemonPass(tree, { counter: () => Promise.resolve(counter) });
    code.nudge();
    await waitFor(() => active === 1);
    // Revision 2 is stored while the first pass counts revision 1.
    tree.write("src/a.ts", "settle 3 B2\n").revise();
    code.nudge();
    code.nudge();
    release();
    await code.idle();
    await code.close();
    expect(reports.map((r) => `${r.mode} ${r.revision}`)).toEqual(["first 1", "edit 2"]);
    expect(most).toBe(1);
  });

  it("deletes a corrupt code store and counts again", async () => {
    const tree = worktree();
    tree.write("src/a.ts", "settle 23 B1\n").revise();
    mkdirSync(storePaths(tree.commonDir).dir, { recursive: true });
    writeFileSync(codeStorePath(tree.commonDir), "not a database, not at all".repeat(200));
    const { code, reports, logs } = daemonPass(tree, {});
    code.nudge();
    await code.idle();
    await code.close();
    expect(logs.join("\n")).toMatch(/code store was corrupt/);
    expect(reports.map((r) => r.mode)).toEqual(["first"]);
    expect(open(tree.commonDir).states.list(tree.id)).toHaveLength(1);
  });

  it("keeps a file whose bytes moved after the stat as it was, and reads it again at the next pass", async () => {
    const tree = worktree();
    tree.write("src/a.ts", "settle 3 B1\n").revise();
    const { code, reports } = daemonPass(tree, {});
    code.nudge();
    await code.idle();
    tree.write("src/a.ts", "settle 23 B2\n").revise();
    // The watcher has not seen this write yet: the stat cache still names B2's blob.
    writeFileSync(join(tree.root, "src/a.ts"), "settle 40 B3\n");
    code.nudge();
    await code.idle();
    const store = open(tree.commonDir);
    expect(store.states.list(tree.id)[0]).toMatchObject({ value: 3, outcome: "pass" });
    writeFileSync(join(tree.root, "src/a.ts"), "settle 23 B2\n");
    code.nudge();
    await code.idle();
    await code.close();
    expect(store.states.list(tree.id)[0]).toMatchObject({ value: 23, outcome: "fail" });
    expect(reports.map((r) => `${r.mode} ${r.files} ${r.counted}`)).toEqual([
      "first 1 1",
      "edit 1 0",
      "edit 1 1",
    ]);
  });

  it("reports a pass that throws and keeps serving nudges", async () => {
    const tree = worktree();
    tree.write("src/a.ts", "settle 23 B1\n").revise();
    let broken = true;
    const source = {
      ...tree.source,
      latestRevision: () => {
        if (broken) throw new Error("store busy");
        return tree.source.latestRevision();
      },
    };
    const { code, reports, errors } = daemonPass(tree, { source });
    code.nudge();
    await code.idle();
    broken = false;
    code.nudge();
    await code.idle();
    await code.close();
    expect(errors.map((e) => e.message)).toEqual(["store busy"]);
    expect(reports.map((r) => r.mode)).toEqual(["first"]);
  });

  it("tells a counter that cannot load once, however many passes find it so", async () => {
    const tree = worktree();
    tree.write("src/a.ts", "settle 23 B1\n").revise();
    const counter = () => Promise.reject(new Error("tree-sitter-tsx.wasm not found"));
    const { code, errors } = daemonPass(tree, { counter });
    for (let i = 0; i < 3; i++) {
      code.nudge();
      await code.idle();
    }
    await code.close();
    expect(errors.map((e) => e.message)).toEqual(["tree-sitter-tsx.wasm not found"]);
  });
});
