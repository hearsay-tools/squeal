import { posix } from "node:path";
import { commitEntries } from "../core/commit/at-keys-verify.js";
import { runGit, splitNul } from "../core/fs/git.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { Tree } from "../core/proof/import-graph.js";
import {
  type ChangedImports,
  codeSideChanges,
  type Settled,
  type Settling,
  settle,
  type Unsettled,
} from "../core/proof/imports.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";

/*
 * Spec 023 D5.2 as amended 2026-11-19 (the human, "A: stop when unsure";
 * row 023-21): each named file's changed code-side imports while it is
 * unchanged, each settled as product code or not (`core/proof/imports.ts`)
 * from the trees at `HEAD` and at `base`, read through git. The importers
 * of a changed file are found at `HEAD` only: whether product code uses
 * it is a fact of the code under test now.
 */

/** A larger file is read only up to this many bytes: imports sit at its top. */
const READ_BYTES = 1_048_576;

export interface ImportsInput {
  readonly root: AbsolutePath;
  readonly base: string;
  readonly head: string;
  readonly refs: readonly TestFileRef[];
  readonly loadsOf: (ref: TestFileRef) => readonly RelativePath[];
  readonly changed: ReadonlySet<RelativePath>;
  /** The named files and the `--with` paths. */
  readonly testSide: ReadonlySet<RelativePath>;
  /** The `--source` paths. */
  readonly source: ReadonlySet<RelativePath>;
}

export interface ImportsAnswer {
  /** Each named file's changed imports, by `testFileId`; `null` when it changed or none did. */
  readonly imports: ReadonlyMap<string, ChangedImports | null>;
  /** Every changed code-side import of an unchanged named file: what `--source` may name. */
  readonly candidates: readonly RelativePath[];
}

export async function importsOf(input: ImportsInput): Promise<ImportsAnswer> {
  const sides = new Map(
    input.refs.map((ref) => [
      testFileId(ref),
      codeSideChanges(ref.path, input.loadsOf(ref), input.changed, input.testSide),
    ]),
  );
  const paths = [...new Set([...sides.values()].flatMap((s) => s.code))].sort();
  const settled = new Map<RelativePath, { settled: Settled } | { unsettled: Unsettled }>();
  if (paths.length > 0) {
    const s: Settling = {
      testSide: input.testSide,
      source: input.source,
      head: await treeOf(input.root, input.head),
      base: await treeOf(input.root, input.base),
      candidates: (path) => mentioning(input.root, input.head, path),
    };
    for (const path of paths) settled.set(path, await settle(path, s));
  }
  const imports = new Map<string, ChangedImports | null>();
  for (const [id, side] of sides) {
    if (side.code.length === 0) {
      imports.set(id, null);
      continue;
    }
    const each = side.code.flatMap((path) => settled.get(path) ?? []);
    imports.set(id, {
      unsettled: each.flatMap((e) => ("unsettled" in e ? [e.unsettled] : [])),
      sources: each.flatMap((e) => ("settled" in e ? [e.settled] : [])),
      testSide: side.testSide,
    });
  }
  return { imports, candidates: paths };
}

/** `commit`'s tree: its entries, and each blob's text read once. */
async function treeOf(root: AbsolutePath, commit: string): Promise<Tree> {
  const entries = await commitEntries(root, commit);
  const texts = new Map<string, Promise<string | null>>();
  return {
    commit,
    has: (path) => entries.has(path),
    text: (path) => {
      const entry = entries.get(path);
      if (entry === undefined || entry.mode === "120000" || entry.mode === "160000")
        return Promise.resolve(null);
      let text = texts.get(entry.blob);
      if (text === undefined) {
        text = runGit(root, ["cat-file", "blob", entry.blob]).then((t) => t.slice(0, READ_BYTES));
        texts.set(entry.blob, text);
      }
      return text;
    },
  };
}

/**
 * The files at `commit` whose text holds the name a local import of `path`
 * uses: its file name without the extension, or its folder's for an
 * `index` or `__init__` file. Each is then checked by resolving its imports.
 */
async function mentioning(
  root: AbsolutePath,
  commit: string,
  path: RelativePath,
): Promise<RelativePath[]> {
  const name = posix.basename(path).replace(/\.[^.]+$/, "");
  const word = name === "index" || name === "__init__" ? posix.basename(posix.dirname(path)) : name;
  if (word === "" || word === ".") return [];
  const out = await runGit(root, ["grep", "-z", "-l", "-I", "-F", "-e", word, commit, "--"], {
    okCodes: [0, 1],
  });
  const prefix = `${commit}:`;
  return splitNul(out)
    .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line))
    .filter((line) => line !== "" && line !== path)
    .sort();
}
