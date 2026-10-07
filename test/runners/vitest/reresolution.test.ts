import { describe, expect, it } from "vitest";
import {
  closuresToReresolve,
  createInputMatcher,
  ReverseIndex,
} from "../../../src/core/keys/index.js";
import type { FileChange } from "../../../src/core/types/index.js";
import { all, openFixture, paths, ref, SLOW } from "./helpers.js";

const pkg = ref("test/pkg.test.ts");
const usesPkg = {
  "src/pkg/index.ts": 'export const which = "index";\n',
  "src/pkg/lib.ts": 'export const which = "main";\n',
  "src/uses.ts": 'export { which } from "./pkg";\n',
  "test/pkg.test.ts": [
    'import { it } from "vitest";',
    'import { which } from "../src/uses.ts";',
    "it(which, () => {});",
    "",
  ].join("\n"),
};

/*
 * Task 001-72: an added or deleted `package.json` re-points the directory it
 * sits in, between its `index` and its entry. The manifest is in no closure
 * and in no module graph, so neither `rekey` nor `affected` reports the
 * importer; `closuresToReresolve` does, because the directory's `index` or
 * entry is in its closure. If `affected` starts reporting it, the heuristic
 * covers nothing `affected` and `rekey` miss (tasks/wave-9.md, 001-72 table).
 */
describe("re-resolution after a package.json is added or deleted", SLOW, () => {
  it.each([
    { kind: "add" as const, before: "src/pkg/index.ts", after: "src/pkg/lib.ts" },
    { kind: "delete" as const, before: "src/pkg/lib.ts", after: "src/pkg/index.ts" },
  ])("$kind: only closuresToReresolve picks the importer", async ({ kind, before, after }) => {
    const manifest = { "src/pkg/package.json": '{ "main": "lib.ts" }\n' };
    const fx = await openFixture("basic", kind === "add" ? usesPkg : { ...usesPkg, ...manifest });
    const closure = (await fx.adapter.closure(pkg)).paths;
    expect(closure).toContain(before);
    expect(closure).not.toContain(after);
    expect(closure).not.toContain("src/pkg/package.json");
    const index = new ReverseIndex();
    index.set(pkg, closure);

    const path = "src/pkg/package.json";
    if (kind === "add") fx.write(path, manifest[path]);
    else fx.remove(path);
    await fx.adapter.invalidate([{ path, kind }]);
    const change: FileChange =
      kind === "add"
        ? { path, oldHash: null, newHash: "h" }
        : { path, oldHash: "h", newHash: null };

    expect(all(await fx.adapter.affected([path]))).toEqual([]);
    expect(index.referencing([path])).toEqual([]);
    expect(paths(closuresToReresolve([change], index, createInputMatcher([])))).toEqual([
      "test/pkg.test.ts",
    ]);
    expect((await fx.adapter.closure(pkg)).paths).toContain(after);
  });
});
