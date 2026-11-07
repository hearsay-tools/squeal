import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lexerReady, moduleFacts } from "../../src/core/reach/modules.js";
import { readEdits } from "../../src/core/store/repos/edits.js";
import type { RevisionTrigger } from "../../src/core/types/revision.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeRepo, seedStore } from "../status/helpers.js";
import { fakeGraph } from "./fixture.js";

/* Row 015-109 (spec 015 D11): the edits read across worktrees, and barrels read from their bytes. */

const open: Store[] = [];
afterEach(() => {
  for (const store of open.splice(0)) store.close();
});

describe("readEdits", () => {
  it("keeps every worktree's watch revisions in which HEAD did not move", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    open.push(store);
    const other = repo.addWorktree("other").id;
    const add = (worktreeId: string, at: number, head: string, trigger: RevisionTrigger) =>
      store.revisions.append({
        worktreeId,
        createdAt: at,
        head,
        dirty: true,
        trigger,
        changes: [{ path: `src/${at}.ts`, oldHash: "a", newHash: "b" }],
      });
    add(repo.mainId, 1, "c1", "start");
    add(repo.mainId, 2, "c1", "watch");
    add(repo.mainId, 3, "c2", "watch");
    add(repo.mainId, 4, "c2", "watch");
    add(repo.mainId, 5, "c2", "interval");
    add(other, 6, "c9", "watch");
    add(other, 7, "c9", "watch");
    expect(readEdits(store)).toEqual([
      { at: 2, paths: ["src/2.ts"] },
      { at: 4, paths: ["src/4.ts"] },
      { at: 7, paths: ["src/7.ts"] },
    ]);
  });
});

describe("moduleFacts", () => {
  it("reads a barrel of value re-exports, never a types-only module, and its export * targets", async () => {
    await lexerReady;
    const root = fakeRepo().main;
    mkdirSync(join(root, "src"));
    const files: Record<string, string> = {
      "src/index.ts":
        'export * from "./a.js";\nexport type * from "./t.js";\nexport { b } from "./b.js";\n',
      "src/t.ts": "export interface T { readonly a: number }\n",
      "src/a.ts": 'import { b } from "./b.js";\nexport function a() { return b; }\n',
      "src/types-index.ts": 'export type { T } from "./t.js";\n',
    };
    for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
    const graph = fakeGraph({ "src/index.ts": ["src/a.ts", "src/b.ts"] });
    const facts = moduleFacts(root, graph);
    expect(Object.keys(files).filter((p) => facts.barrel(p))).toEqual(["src/index.ts"]);
    expect(facts.starTargets("src/index.ts", { project: "", path: "test/a.test.ts" })).toEqual(
      new Set(["src/a.ts"]),
    );
    expect(facts.barrel("src/missing.ts")).toBe(false);
  });

  it("reads whether a module exports a runtime value from its bytes, not its function count (015-116, P4)", async () => {
    await lexerReady;
    const root = fakeRepo().main;
    mkdirSync(join(root, "src"));
    const files: Record<string, string> = {
      // Squeal's src/core/types/policy.ts: no function, and a value, DEFAULT_POLICY.
      "src/policy.ts":
        "export interface Policy { readonly a: number }\nexport const DEFAULT_POLICY: Policy = { a: 1 };\n",
      "src/state.ts":
        'import type { Policy } from "./policy.js";\nexport type State = Policy | null;\nexport interface Run { readonly at: number }\nexport declare const marker: unique symbol;\nexport type { Policy };\n',
      "src/kinds.ts": "export enum Kind {\n  A,\n  B,\n}\n",
      "src/again.ts": 'export * from "./policy.js";\n',
      "src/types-again.ts": 'export type * from "./policy.js";\n',
    };
    for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
    const facts = moduleFacts(root, null);
    expect(Object.fromEntries(Object.keys(files).map((p) => [p, facts.exportsValue(p)]))).toEqual({
      "src/policy.ts": true,
      "src/state.ts": false,
      "src/kinds.ts": true,
      "src/again.ts": true,
      "src/types-again.ts": false,
    });
    expect(facts.exportsValue("src/gone.ts")).toBeNull();
    expect(facts.hasBytes("src/state.ts")).toBe(true);
    expect(facts.hasBytes("src/gone.ts")).toBe(false);
  });
});
