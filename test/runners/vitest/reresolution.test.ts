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
const json = (fields: object) => `${JSON.stringify(fields)}\n`;
/** The fixture's own root manifest, with `fields` added. */
const root = (fields: object) =>
  json({ name: "squeal-fixture-vitest-basic", private: true, type: "module", ...fields });

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
  // Reviews/wave-9b.md E5 (S1): Vite caches a package's data, `imports` included.
  {
    name: "imports of a workspace package edited: its subpath import resolves to the new target",
    manifest: "packages/a/package.json",
    from: json({ name: "a", main: "src/entry.ts", imports: { "#x": "./src/one.ts" } }),
    to: json({ name: "a", main: "src/entry.ts", imports: { "#x": "./src/two.ts" } }),
    files: {
      "packages/a/src/entry.ts": 'export { which } from "#x";\n',
      ...module("packages/a/src/one.ts"),
      ...module("packages/a/src/two.ts"),
    },
    specifier: "a",
    workspace: true,
    before: "packages/a/src/one.ts",
    after: "packages/a/src/two.ts",
  },
  // A nested manifest's `imports` shadows the root's for files below it.
  {
    name: "a nested manifest with imports deleted: the root's imports apply",
    manifest: "src/pkg/package.json",
    from: json({ imports: { "#x": "./one.ts" } }),
    to: null,
    files: {
      "package.json": root({ imports: { "#x": "./src/two.ts" } }),
      "src/pkg/index.ts": 'export { which } from "#x";\n',
      ...module("src/pkg/one.ts"),
      ...module("src/two.ts"),
    },
    specifier: "../src/pkg/index.ts",
    before: "src/pkg/one.ts",
    after: "src/two.ts",
  },
  {
    name: "a nested manifest with imports added: it shadows the root's",
    manifest: "src/pkg/package.json",
    from: null,
    to: json({ imports: { "#x": "./one.ts" } }),
    files: {
      "package.json": root({ imports: { "#x": "./src/two.ts" } }),
      "src/pkg/index.ts": 'export { which } from "#x";\n',
      ...module("src/pkg/one.ts"),
      ...module("src/two.ts"),
    },
    specifier: "../src/pkg/index.ts",
    before: "src/two.ts",
    after: "src/pkg/one.ts",
  },
  // Reviews/wave-9b.md E6 (S1, S2): the root manifest re-resolves every closure.
  {
    name: "imports of the root manifest edited: its subpath import resolves to the new target",
    manifest: "package.json",
    from: root({ imports: { "#lib": "./src/pa.ts" } }),
    to: root({ imports: { "#lib": "./src/pb.ts" } }),
    files: { ...module("src/pa.ts"), ...module("src/pb.ts") },
    specifier: "#lib",
    before: "src/pa.ts",
    after: "src/pb.ts",
  },
  // Reviews/wave-9b.md E7 (S2): the root package imported by its own name.
  {
    name: "exports of the root manifest edited: the package imported by name resolves anew",
    manifest: "package.json",
    from: root({ exports: { ".": "./src/pa.ts" } }),
    to: root({ exports: { ".": "./src/pb.ts" } }),
    files: { ...module("src/pa.ts"), ...module("src/pb.ts") },
    specifier: "squeal-fixture-vitest-basic",
    before: "src/pa.ts",
    after: "src/pb.ts",
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

/*
 * Reviews/wave-9b.md S3: an edit that changes no resolution field stales
 * nothing, and records the fields, so the next edit that does still moves.
 */
describe("re-resolution after package.json edits that change no resolution field", SLOW, () => {
  it("keeps the entry for a scripts edit and follows the next main edit", async () => {
    const manifest = "src/pkg/package.json";
    const withScripts = (entry: string, script: string) =>
      json({ name: "a", main: entry, scripts: { gen: script } });
    const fx = await openFixture("basic", {
      ...module("src/pkg/lib.ts"),
      ...module("src/pkg/other.ts"),
      "src/uses.ts": 'export { which } from "./pkg";\n',
      [manifest]: withScripts("lib.ts", "one"),
      [pkg.path]: readsTest("../src/uses.ts", "src/pkg/other.ts"),
    });
    const edit = async (content: string) => {
      fx.write(manifest, content);
      await fx.adapter.invalidate([{ path: manifest, kind: "change" }]);
      return (await fx.adapter.closure(pkg)).paths;
    };
    expect(outcomes(await fx.adapter.run([pkg], fx.runOptions()))).toEqual(["fail"]);
    expect(await edit(withScripts("lib.ts", "two"))).toContain("src/pkg/lib.ts");
    expect(await edit(withScripts("lib.ts", "three"))).toContain("src/pkg/lib.ts");
    const moved = await edit(withScripts("other.ts", "three"));
    expect(moved).toContain("src/pkg/other.ts");
    expect(moved).not.toContain("src/pkg/lib.ts");
    expect(outcomes(await fx.adapter.run([pkg], fx.runOptions()))).toEqual(["pass"]);
  });
});

/*
 * Reviews/wave-9c.md B1: a field the project names in `resolve.mainFields` is
 * read by the resolver, so an edit of only that field is not skipped.
 */
describe("re-resolution after an edit of a field named in resolve.mainFields", SLOW, () => {
  it("follows an edit of only that field", async () => {
    const manifest = "src/pkg/package.json";
    const withSource = (entry: string) => json({ name: "a", source: entry });
    const fx = await openFixture("basic", {
      "vitest.config.ts": [
        'import { defineConfig } from "vitest/config";',
        'import { include } from "./vitest.shared.ts";',
        "const resolve = { mainFields: ['source'] };",
        "export default defineConfig({",
        "  environments: { ssr: { resolve }, client: { resolve } },",
        '  test: { include, setupFiles: ["test/setup.ts"], globalSetup: ["test/global-setup.ts"], testTimeout: 60_000 },',
        "});",
        "",
      ].join("\n"),
      ...module("src/pkg/lib.ts"),
      ...module("src/pkg/other.ts"),
      "src/uses.ts": 'export { which } from "./pkg";\n',
      [manifest]: withSource("lib.ts"),
      [pkg.path]: readsTest("../src/uses.ts", "src/pkg/other.ts"),
    });
    const edit = async (content: string) => {
      fx.write(manifest, content);
      await fx.adapter.invalidate([{ path: manifest, kind: "change" }]);
      return (await fx.adapter.closure(pkg)).paths;
    };
    expect(outcomes(await fx.adapter.run([pkg], fx.runOptions()))).toEqual(["fail"]);
    expect(await edit(json({ name: "a", source: "lib.ts", scripts: { gen: "one" } }))).toContain(
      "src/pkg/lib.ts",
    );
    const moved = await edit(withSource("other.ts"));
    expect(moved).toContain("src/pkg/other.ts");
    expect(moved).not.toContain("src/pkg/lib.ts");
    expect(outcomes(await fx.adapter.run([pkg], fx.runOptions()))).toEqual(["pass"]);
  });
});
