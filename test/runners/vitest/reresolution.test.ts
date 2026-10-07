import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  closuresToReresolve,
  createInputMatcher,
  ReverseIndex,
} from "../../../src/core/keys/index.js";
import type { FileChange } from "../../../src/core/types/index.js";
import { all, openFixture, outcomes, paths, readsTest, ref, SLOW } from "./helpers.js";

const pkg = ref("test/pkg.test.ts");
const module = (path: string) => ({ [path]: `export const which = "${path}";\n` });
const main = (entry: string) => `${JSON.stringify({ name: "a", main: entry })}\n`;

interface Case {
  readonly name: string;
  readonly manifest: string;
  /** The manifest's content before and after; `null` when it does not exist. */
  readonly from: string | null;
  readonly to: string | null;
  readonly files: Readonly<Record<string, string>>;
  readonly specifier: string;
  /** `node_modules/a` links to `packages/a`, as a workspace install leaves it. */
  readonly workspace?: true;
  readonly before: string;
  readonly after: string;
}

const local = (rest: Omit<Case, "manifest" | "specifier">): Case => ({
  ...rest,
  manifest: "src/pkg/package.json",
  specifier: "../src/uses.ts",
  files: { ...rest.files, "src/uses.ts": 'export { which } from "./pkg";\n' },
});

const cases: Case[] = [
  local({
    name: "added: the directory leaves its index for the entry",
    from: null,
    to: main("lib.ts"),
    files: { ...module("src/pkg/index.ts"), ...module("src/pkg/lib.ts") },
    before: "src/pkg/index.ts",
    after: "src/pkg/lib.ts",
  }),
  local({
    name: "deleted: the directory falls back to its index",
    from: main("lib.ts"),
    to: null,
    files: { ...module("src/pkg/index.ts"), ...module("src/pkg/lib.ts") },
    before: "src/pkg/lib.ts",
    after: "src/pkg/index.ts",
  }),
  // Reviews/wave-9.md P2a and P2a2 (S1): the entry lies below the directory.
  local({
    name: "deleted, its entry a file below it: the directory falls back to its index",
    from: main("lib/entry.ts"),
    to: null,
    files: { ...module("src/pkg/index.ts"), ...module("src/pkg/lib/entry.ts") },
    before: "src/pkg/lib/entry.ts",
    after: "src/pkg/index.ts",
  }),
  local({
    name: "deleted, its entry a directory below it: the directory falls back to its index",
    from: main("lib"),
    to: null,
    files: { ...module("src/pkg/index.ts"), ...module("src/pkg/lib/index.ts") },
    before: "src/pkg/lib/index.ts",
    after: "src/pkg/index.ts",
  }),
  // Reviews/wave-9.md P1 (S2).
  local({
    name: "main edited: the directory resolves to the new entry",
    from: main("lib.ts"),
    to: main("other.ts"),
    files: { ...module("src/pkg/lib.ts"), ...module("src/pkg/other.ts") },
    before: "src/pkg/lib.ts",
    after: "src/pkg/other.ts",
  }),
  // Reviews/wave-9.md P3c (S2): a workspace package imported by name.
  {
    name: "main of a workspace package edited: its name resolves to the new entry",
    manifest: "packages/a/package.json",
    from: main("src/one.ts"),
    to: main("src/two.ts"),
    files: { ...module("packages/a/src/one.ts"), ...module("packages/a/src/two.ts") },
    specifier: "a",
    workspace: true,
    before: "packages/a/src/one.ts",
    after: "packages/a/src/two.ts",
  },
];

/*
 * Task 001-72, reviews/wave-9.md S1 and S2: adding, deleting or editing a
 * `package.json` re-points the directory it sits in, between its `index` and
 * the entries it names. The manifest is in no closure and in no module graph,
 * so neither `rekey` nor `affected` reports the importer; `closuresToReresolve`
 * does, because the directory's `index` or an entry below it is in its
 * closure. If `affected` starts reporting it, the heuristic covers nothing
 * `affected` and `rekey` miss (tasks/wave-9.md, 001-72 table).
 */
describe("re-resolution after a package.json is added, deleted or edited", SLOW, () => {
  it.each(cases)("$name", async (c) => {
    const fx = await openFixture("basic", {
      ...c.files,
      ...(c.from === null ? {} : { [c.manifest]: c.from }),
      [pkg.path]: readsTest(c.specifier, c.after),
    });
    if (c.workspace) {
      mkdirSync(join(fx.root, "node_modules"));
      symlinkSync(join(fx.root, "packages/a"), join(fx.root, "node_modules/a"));
    }
    expect(outcomes(await fx.adapter.run([pkg], fx.runOptions()))).toEqual(["fail"]);
    const closure = (await fx.adapter.closure(pkg)).paths;
    expect(closure).toContain(c.before);
    expect(closure).not.toContain(c.after);
    expect(closure).not.toContain(c.manifest);
    const index = new ReverseIndex();
    index.set(pkg, closure);

    const path = c.manifest;
    if (c.to === null) fx.remove(path);
    else fx.write(path, c.to);
    const kind = c.from === null ? "add" : c.to === null ? "delete" : "change";
    await fx.adapter.invalidate([{ path, kind }]);
    const change: FileChange = {
      path,
      oldHash: c.from === null ? null : "h1",
      newHash: c.to === null ? null : "h2",
    };

    expect(all(await fx.adapter.affected([path]))).toEqual([]);
    expect(index.referencing([path])).toEqual([]);
    expect(paths(closuresToReresolve([change], index, createInputMatcher([])))).toEqual([pkg.path]);
    expect((await fx.adapter.closure(pkg)).paths).toContain(c.after);
    expect(outcomes(await fx.adapter.run([pkg], fx.runOptions()))).toEqual(["pass"]);
  });
});
