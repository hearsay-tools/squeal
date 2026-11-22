import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AtDaemons } from "../../src/cli/status-at-daemons.js";
import { changeOf } from "../../src/core/daemon/at-asks.js";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { run, standIn, standInTree, testOf } from "./status-at-kit.js";

/*
 * Review 0.1.599 B4 (spec 023 D7.1, V8): the commit daemon is shared by
 * every worktree and caller of one commit, and their changes differ. A
 * narrowed `--wait` read the newest kept count, another caller's 4 for a
 * change of two sources, as "the change selects 4". The count is the
 * call's only when the ask that counted it has the call's change.
 */

const A = ref("test/a.test.ts");
const B = [ref("test/b1.test.ts"), ref("test/b2.test.ts"), ref("test/b3.test.ts")];

/** Commit A: one test reads `src/a.ts`, three read `src/b.ts`; HEAD changes only `src/a.ts`. */
function mixed() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 2;\n",
    "src/b.ts": "export const value = 2;\n",
    [A.path]: testOf("a", 2),
    ...Object.fromEntries(B.map((file) => [file.path, testOf("b", 2)])),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2; // b\n" });
  return { f, a };
}

describe("a narrowed wait's selection count (review 0.1.599 B4)", SLOW, () => {
  it("reads the count of its own change only: not another caller's, not one from before an edit", async () => {
    const { f, a } = mixed();
    const tree = standInTree(f);
    const base = standIn(tree, () => undefined, { select: () => [A] });
    // The shared daemon keeps this caller's ask (1 selected), then another worktree's, whose
    // change names both sources (4 selected).
    const other = {
      owner: "another-worktree",
      change: changeOf(["src/a.ts", "src/b.ts"]),
      phase: "queued" as const,
      files: [],
      readers: {},
      problems: [],
      selects: 4,
    };
    const ports: AtDaemons = {
      ...base.ports,
      async commitRead(at, owners, bound) {
        const read = await base.ports.commitRead(at, owners, bound);
        if (typeof read === "string") return read;
        const own = read.asks.map((ask) => ({ ...ask, selects: 1 }));
        return { ...read, asks: owners === undefined ? [...own, other] : own };
      },
    };
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, daemons: ports };
    await run(f, { commit: a, run: { allMissing: false }, waitMs: 2000 }, options);

    const join1 = await run(f, { commit: a, paths: [A.path], waitMs: 2000, json: true }, options);
    expect(JSON.parse(join1.out).scope).toMatchObject({ paths: [A.path], files: 1, selects: 1 });

    // An edit since: the change is no longer the one either ask counted.
    writeFileSync(join(f.root, "src/c.ts"), "export const value = 3;\n");
    const join2 = await run(f, { commit: a, paths: [A.path], waitMs: 2000, json: true }, options);
    expect(JSON.parse(join2.out).scope).toMatchObject({ files: 1, selects: null });
    const text = await run(f, { commit: a, paths: [A.path], waitMs: 2000 }, options);
    expect(text.out).toContain(", of 1 named test file; the change may select more (");

    // The same edit as the other caller's change: its count is this change's too.
    rmSync(join(f.root, "src/c.ts"));
    writeFileSync(join(f.root, "src/b.ts"), "export const value = 2; // edited\n");
    const join3 = await run(f, { commit: a, paths: [A.path], waitMs: 2000, json: true }, options);
    expect(JSON.parse(join3.out).scope).toMatchObject({ selects: 4 });
  });
});
