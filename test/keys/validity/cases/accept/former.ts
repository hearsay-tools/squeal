import type { TestCheckId, TestFileRef } from "../../../../../src/core/types/index.js";
import type { Case } from "../../case.js";

/*
 * Row 011-90 (task 011-85 R4; 011 C3): each tree stores a pass at the key it
 * computes over one install, the release under the definition before 011-85
 * (the hidden lockfile whole, the root's version in it), the candidate under
 * its own. The candidate's lookup over the release's store finds the row
 * through the former definition, as over its own store at its key. With no
 * row stored, each tree's lookup misses and reads its keys read as one.
 */

const testFile: TestFileRef = { project: "", path: "test/a.test.ts" };
const check: TestCheckId = { kind: "test", project: "", testPath: testFile.path, fullName: "adds" };

const lockfile = {
  name: "app",
  version: "1.4.0",
  lockfileVersion: 3,
  requires: true,
  packages: { "node_modules/a": { version: "1.0.0", integrity: "sha512-a" } },
};
const installed = {
  "node_modules/a/package.json": '{"name":"a","version":"1.0.0"}',
  "node_modules/.package-lock.json": JSON.stringify(lockfile),
  "patches/a+1.0.0.patch": "--- a/index.js\n+++ b/index.js\n",
};
const pass = {
  worktree: "A",
  report: {
    results: [{ check, outcome: "pass" as const, durationMs: 3, location: null, errors: [] }],
  },
  recordedAt: 1_000,
};

/*
 * Row 011-167 (task 011-162 R3): over a trusted pnpm install the release keys the file by the
 * whole fingerprint, the candidate by its per-package segment; the candidate's lookup over the
 * release's store finds the row through today's pnpm definition read as one.
 */
const pnpmLock = [
  "lockfileVersion: '9.0'",
  "",
  "importers:",
  "",
  "  .:",
  "    dependencies:",
  "      a:",
  "        specifier: ^1.0.0",
  "        version: 1.0.0",
  "",
  "packages:",
  "",
  "  a@1.0.0:",
  "    resolution: {integrity: sha512-a}",
  "",
  "snapshots:",
  "",
  "  a@1.0.0: {}",
  "",
].join("\n");
const pnpm = {
  "node_modules/.pnpm/a@1.0.0/node_modules/a/package.json": '{"name":"a","version":"1.0.0"}',
  "node_modules/.pnpm/a@1.0.0/node_modules/a/index.js": "module.exports = 1;\n",
  "node_modules/.modules.yaml": JSON.stringify({
    nodeLinker: "isolated",
    virtualStoreDir: ".pnpm",
  }),
  "node_modules/.pnpm/lock.yaml": pnpmLock,
};
const importsA = { imports: [{ from: "", name: "a" }], builtins: [] };

export const FORMER: readonly Case[] = [
  {
    kind: "accept",
    name: "a pass stored over an install with a root version",
    why: "011-90: a row stored under the definition before 011-85 is read as one",
    input: { testFile, installed, runs: [pass], receiver: "B" },
  },
  {
    kind: "accept",
    name: "no row stored over an install with a root version",
    why: "011-90: a miss reads the keys at the formats and the definition read as one, and finds none",
    input: { testFile, installed, runs: [], receiver: "B" },
  },
  {
    kind: "accept",
    name: "a pass stored over a trusted pnpm install",
    why: "011-167: a row stored under the pnpm definition before 011-162 is read as one",
    input: { testFile, installed: pnpm, packages: importsA, runs: [pass], receiver: "B" },
  },
];
