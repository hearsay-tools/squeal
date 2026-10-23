import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PackageScans, PnpmGraph } from "../../src/core/keys/index.js";
import { readPnpmLockfile } from "../../src/core/keys/pnpm-lockfile.js";
import type { PackageImport } from "../../src/core/types/index.js";
import { tempDir } from "../hash/git-repo.js";
import { type PnpmFixture, pnpmLockfileText, writePnpmInstall } from "./install.js";

// Task 011-162 R1 (011 C11, design sections 1 and 2): pnpm's installed graph. A package entry Vite
// resolved, `node_modules/.pnpm/<folder>/node_modules/<name>/…`, is the snapshot pnpm names
// `<folder>`; another name from there resolves through its edges, the private hoisting, then the
// root; a bare name through the nearest importer that declares it, at the root the public
// hoisting too. A key holds `<snapshot id>#<integrity>` with the snapshot's edges.

const INSTALL: PnpmFixture = {
  importers: {
    ".": { alias: "real@1.0.0", host: "1.0.0", p: "1.0.0(q@1.0.0)", vitest: "4.0.0" },
    "packages/app": { a: "1.0.0", c: "1.0.0", lib: "link:../lib", p: "1.0.0(q@2.0.0)" },
    "packages/lib": {},
  },
  snapshots: {
    "@types/x@1.0.0": { files: { "index.d.ts": "export {};\n" } },
    "a@1.0.0": { dependencies: { b: "1.0.0" } },
    "b@1.0.0": {},
    "c@1.0.0": { dependencies: { "@types/x": "1.0.0" } },
    "fsevents@2.3.3": { skipped: true },
    "host@1.0.0": { optionalDependencies: { fsevents: "2.3.3" } },
    "p@1.0.0(q@1.0.0)": { dependencies: { q: "1.0.0" } },
    "p@1.0.0(q@2.0.0)": { dependencies: { q: "2.0.0" } },
    "pub@1.0.0": { files: { "index.js": 'require("node:child_process");\n' } },
    "q@1.0.0": {},
    "q@2.0.0": {},
    "real@1.0.0": {},
    "vitest@4.0.0": {},
  },
  modules: {
    hoistedDependencies: { "b@1.0.0": { b: "private" }, "pub@1.0.0": { pub: "public" } },
  },
};

/** The identity of a fixture snapshot: its integrity is `sha512-<name@version>`. */
const id = (snapshot: string, ...edges: string[]) =>
  `${snapshot}#sha512-${snapshot.replace(/\(.*$/, "")}${edges.length ? `>${edges.join(",")}` : ""}`;

describe("PnpmGraph (011-162, R1)", () => {
  let dir: ReturnType<typeof tempDir>;
  let graph: PnpmGraph;
  beforeEach(() => {
    dir = tempDir();
    writePnpmInstall(dir.path, INSTALL);
    graph = graphOf(dir.path);
  });
  afterEach(() => dir.cleanup());

  const identities = (...imports: PackageImport[]) => graph.identities(imports);

  it("keys a resolved entry by its folder's snapshot, with its edges, closed over them", () => {
    expect(identities({ from: "node_modules/.pnpm/a@1.0.0", name: "a" })).toEqual([
      id("a@1.0.0", "b@1.0.0"),
      id("b@1.0.0"),
    ]);
  });

  it("resolves another name from a folder through its edges, then the private hoisting", () => {
    expect(identities({ from: "node_modules/.pnpm/a@1.0.0", name: "b" })).toEqual([id("b@1.0.0")]);
    expect(identities({ from: "node_modules/.pnpm/q@1.0.0", name: "b" })).toEqual([id("b@1.0.0")]);
    expect(identities({ from: "node_modules/.pnpm/q@1.0.0", name: "vitest" })).toEqual([
      id("vitest@4.0.0"),
    ]);
  });

  it("resolves a bare name through the nearest importer that declares it, the root's public hoisting last", () => {
    expect(identities({ from: "packages/app/src/deep", name: "c" })).toEqual([
      "@types/x@1.0.0@types-only",
      id("c@1.0.0", "@types/x@1.0.0"),
    ]);
    expect(identities({ from: "packages/app/src", name: "vitest" })).toEqual([id("vitest@4.0.0")]);
    expect(identities({ from: "test", name: "pub" })).toEqual([id("pub@1.0.0")]);
    expect(identities({ from: "packages/app", name: "b" })).toEqual(["absent:packages/app>b"]);
    expect(identities({ from: "test", name: "nothing" })).toEqual(["absent:test>nothing"]);
  });

  it("keys a linked workspace by its path", () => {
    expect(identities({ from: "packages/app", name: "lib" })).toEqual(["workspace:packages/lib"]);
  });

  it("keys two peer variants of one package apart, each with its own edges", () => {
    expect(identities({ from: "test", name: "p" })).toEqual([
      id("p@1.0.0(q@1.0.0)", "q@1.0.0"),
      id("q@1.0.0"),
    ]);
    expect(identities({ from: "packages/app", name: "p" })).toEqual([
      id("p@1.0.0(q@2.0.0)", "q@2.0.0"),
      id("q@2.0.0"),
    ]);
    expect(identities({ from: "node_modules/.pnpm/p@1.0.0_q@2.0.0", name: "p" })).toEqual(
      identities({ from: "packages/app", name: "p" }),
    );
  });

  it("keys an alias by the snapshot it names", () => {
    expect(identities({ from: "", name: "alias" })).toEqual([id("real@1.0.0")]);
  });

  it("keys a skipped optional child by its identity, neither expanded nor scanned", () => {
    const found = identities({ from: "", name: "host" });
    expect(found).toEqual([id("host@1.0.0", "fsevents@2.3.3"), `skipped:${id("fsevents@2.3.3")}`]);
    expect(graph.opaque(found)).toBe(false);
  });

  it("keys a folder no snapshot names as unknown, which sends the file to the whole fingerprint", () => {
    const found = identities({ from: "node_modules/.pnpm/a@0.9.0", name: "a" });
    expect(found).toEqual(["unknown:a@0.9.0"]);
    expect(graph.opaque(found)).toBe(true);
  });

  it("keys only the package itself for an import of its manifest, and leaves out excluded ones", () => {
    const a = { from: "node_modules/.pnpm/a@1.0.0", name: "a" };
    expect(identities({ ...a, manifest: true })).toEqual([id("a@1.0.0", "b@1.0.0")]);
    expect(graph.identities([a], new Set([id("b@1.0.0")]))).toEqual([id("a@1.0.0", "b@1.0.0")]);
  });

  it("finds an opaque package by its folder, and a package without an integrity is opaque", () => {
    expect(graph.opaque(identities({ from: "test", name: "pub" }))).toBe(true);
    expect(graph.opaque(identities({ from: "packages/app", name: "a" }))).toBe(false);
    const text = pnpmLockfileText(INSTALL).replace(
      "resolution: {integrity: sha512-real@1.0.0}",
      "resolution: {tarball: https://example.com/real.tgz}",
    );
    const tarball = graphOf(dir.path, text);
    const found = tarball.identities([{ from: "", name: "alias" }]);
    expect(found).toEqual(["nointegrity:real@1.0.0"]);
    expect(tarball.opaque(found)).toBe(true);
  });

  it("looks up from the install's own directory when it lies below the worktree root", () => {
    const below = graphOf(dir.path, undefined, "sub");
    expect(below.identities([{ from: "sub/node_modules/.pnpm/b@1.0.0", name: "b" }])).toEqual([
      id("b@1.0.0"),
    ]);
    expect(below.identities([{ from: "other", name: "b" }])).toEqual(["absent:other>b"]);
  });
});

function graphOf(root: string, text?: string, base = ""): PnpmGraph {
  const lockfile = readPnpmLockfile(text ?? pnpmLockfileText(INSTALL));
  if (lockfile === null) throw new Error("the fixture's lock.yaml reads");
  const modules = JSON.parse(readFileSync(join(root, "node_modules/.modules.yaml"), "utf8"));
  return new PnpmGraph(root, base, lockfile, modules, new PackageScans());
}
