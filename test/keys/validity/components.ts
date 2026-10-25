import type { CaseKind } from "./case.js";

/*
 * The alarm's table (011 C3, C12, C14; task 011-37 section 2): each
 * component whose version re-keys checks, the module under `entries/` that
 * names the code deciding what it stores or accepts, the files out of
 * esbuild's reach compared as text, and the case kinds whose outputs it
 * answers for. A component fires when its entries' emitted code, its text
 * files or the lock lines of the packages its bundle imports differ from
 * the last release's.
 */

export interface Component {
  /** As the verdict names it. */
  readonly name: string;
  /** The version its change of stored meaning raises: the file and the constant. */
  readonly version: { readonly path: string; readonly constant: string };
  /** Its entries module, relative to `test/keys/validity/`. */
  readonly entries: string;
  /** Tree-relative files compared as text: a directory stands for its files with one of `suffixes`. */
  readonly texts: readonly { readonly path: string; readonly suffixes: readonly string[] }[];
  /** The kinds whose differing outputs ask to raise its version. */
  readonly kinds: readonly CaseKind[];
}

export const FORMAT_FILE = "src/core/keys/key-format.ts";

/** The validity path proper, under the format every check's key holds. */
export const GLOBAL: Component = {
  name: "global",
  version: { path: FORMAT_FILE, constant: "KEY_FORMAT_VERSION" },
  entries: "entries/global.ts",
  texts: [],
  kinds: ["key", "rows", "accept", "assemble", "store"],
};

export const COMPONENTS: readonly Component[] = [
  GLOBAL,
  {
    name: "vitest",
    version: { path: "src/runners/vitest/version.ts", constant: "VITEST_ADAPTER_VERSION" },
    entries: "entries/vitest.ts",
    texts: [],
    kinds: ["adapter:vitest"],
  },
  {
    name: "node:test",
    version: { path: "src/runners/node-test/version.ts", constant: "NODE_TEST_ADAPTER_VERSION" },
    entries: "entries/node-test.ts",
    texts: [{ path: "src/runners/node-test/runtime", suffixes: [".cjs", ".mjs"] }],
    kinds: ["adapter:node-test"],
  },
  {
    name: "pytest",
    version: { path: "src/runners/pytest/version.ts", constant: "PYTEST_ADAPTER_VERSION" },
    entries: "entries/pytest.ts",
    texts: [{ path: "src/runners/pytest/runtime", suffixes: [".py"] }],
    kinds: ["adapter:pytest"],
  },
  {
    name: "recorder",
    version: { path: "src/runners/observe/runtime.ts", constant: "RECORDER_VERSION" },
    entries: "entries/recorder.ts",
    texts: [{ path: "src/runners/observe", suffixes: [".cjs"] }],
    kinds: ["observe"],
  },
];

/** The component whose version a kind's differing outputs ask to raise. */
export function componentOf(kind: CaseKind): Component {
  const found = COMPONENTS.find((c) => c.kinds.includes(kind));
  if (found === undefined) throw new Error(`no component answers for the ${kind} kind`);
  return found;
}

/** `name (path)`, as a failure names a version to raise. */
export const versionName = (c: Component) => `${c.version.constant} (${c.version.path})`;
