import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join, posix } from "node:path";
import {
  type ParsedModule,
  parseModule,
  parserReady,
} from "../../runners/node-test/graph/parse.js";
import { createDeclaredInputs } from "../keys/closure.js";
import { listedDirectory } from "../keys/observed.js";
import type { KeyParts } from "../store/transfer-bundle.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { FileHash, TestFileRef } from "../types/keys.js";
import type { PolicyInputs } from "../types/policy.js";
import { blobText } from "./at-environment-lockfile.js";

/*
 * Spec 023 D2.1, review of wave 1 B1: this worktree's closure list proves a
 * key at another commit only when it covers what a run there would read. A
 * static closure is a function of the files' bytes, so the list covers the
 * target run when:
 *
 * - every list file whose blob differs between here and the target has, at
 *   the target, only imports that resolve to list files (relative ones, read
 *   from git objects), builtins, or packages this worktree's file imports
 *   too; a computed import, a glob, or an import that resolves to nothing
 *   leaves it open;
 * - no file at the target can take the place of a list file in a resolution
 *   (`x.ts` beside `x/index.ts`) unless neither changed;
 * - the target's declared inputs (policy `inputs` over its files) are all in
 *   the list;
 * - with any list file changed, the file has no observed run-time reads and
 *   its key parts are empty: reads and per-package parts at the target are
 *   not known without a run.
 *
 * Otherwise the file is not determined (closure), with the reason.
 */

/** Why the list may not cover the target run of `ref`, or `null` when it does. */
export type Coverage = (
  ref: TestFileRef,
  closure: readonly RelativePath[],
  open: { readonly parts: KeyParts; readonly observed: boolean },
) => string | null;

export interface CoverageInput {
  readonly root: AbsolutePath;
  /** The target's blobs (`committedBlobs`, `mixedBlobs`). */
  readonly blobs: ReadonlyMap<RelativePath, FileHash>;
  /** This worktree's file hashes, as its keys hold them. */
  readonly here: ReadonlyMap<RelativePath, FileHash>;
  /** Every closure path the coverage will be asked of. */
  readonly paths: Iterable<RelativePath>;
  /** Policy `inputs`. */
  readonly inputs: PolicyInputs;
}

/** Extensions a resolution tries, and those it reads a stem of. */
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const PARSED = /\.(?:[mc]?[jt]s|[jt]sx)$/;
/** A `.js` specifier names a TypeScript source too. */
const SOURCE_OF: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};
const BUILTINS = new Set(builtinModules);
/** Files read at once. */
const READS = 16;

/** The coverage of closure lists at the target, its changed modules read once. */
export async function targetCoverage(input: CoverageInput): Promise<Coverage> {
  await parserReady;
  const { root, blobs, here } = input;
  const differs = (path: RelativePath) => (blobs.get(path) ?? null) !== (here.get(path) ?? null);
  const changed = [...new Set(input.paths)].filter(
    (path) => listedDirectory(path) === null && PARSED.test(path) && differs(path),
  );
  const target = new Map<RelativePath, ParsedModule | null>();
  const current = new Map<RelativePath, ParsedModule | null>();
  for (let at = 0; at < changed.length; at += READS) {
    await Promise.all(
      changed.slice(at, at + READS).map(async (path) => {
        const blob = blobs.get(path);
        target.set(path, blob === undefined ? null : parseModule(await blobText(root, blob), path));
        const text = await readOrNull(join(root, path));
        current.set(path, text === null ? null : parseModule(text, path));
      }),
    );
  }
  const byStem = new Map<string, RelativePath[]>();
  for (const path of blobs.keys()) {
    const stem = stemOf(path);
    if (stem !== null) byStem.set(stem, [...(byStem.get(stem) ?? []), path]);
  }
  const declared = createDeclaredInputs(input.inputs, blobs.keys());
  return (ref, closure, open) => {
    const list = new Set(closure);
    if (!blobs.has(ref.path)) return "the test file is absent at the commit";
    const missing = declared.for(ref.path).find((path) => !list.has(path));
    if (missing !== undefined) return `declared input ${missing} at the commit is not in the list`;
    for (const path of closure) {
      const stem = stemOf(path);
      const others = stem === null ? [] : (byStem.get(stem) ?? []);
      const outside = others.find((other) => !list.has(other));
      if (outside !== undefined && [path, ...others].some(differs)) {
        return `${outside} at the commit can take the place of ${path}`;
      }
    }
    const first = closure.find(differs);
    if (first === undefined) return null;
    if (open.observed)
      return `the file reads files at run time, and ${first} differs at the commit`;
    if (open.parts.dependencies !== "" || open.parts.runtime !== "") {
      return `its key parts at the commit are not known: ${first} differs`;
    }
    for (const path of closure) {
      const module = target.get(path);
      if (module === undefined || module === null) continue;
      const gap = importsGap(path, module, current.get(path) ?? null, list, blobs);
      if (gap !== null) return gap;
    }
    return null;
  };
}

/** Why `module`, `path` at the target, may load a file outside `list`; `null` when it cannot. */
function importsGap(
  path: RelativePath,
  module: ParsedModule,
  current: ParsedModule | null,
  list: ReadonlySet<RelativePath>,
  blobs: ReadonlyMap<RelativePath, FileHash>,
): string | null {
  if (module.unnamed || module.incomplete.length > 0) {
    return `${path} at the commit loads a module it does not name`;
  }
  const named = new Set(current?.specifiers.map((s) => s.specifier) ?? []);
  for (const { specifier, kind } of module.specifiers) {
    if (kind === "glob") return `${path} at the commit imports the glob ${specifier}`;
    if (isBuiltin(specifier)) continue;
    if (!isRelative(specifier)) {
      if (named.has(specifier)) continue;
      return `${path} imports ${specifier} at the commit, which this worktree's file does not`;
    }
    const held = candidates(posix.dirname(path), specifier).filter((c) => blobs.has(c));
    if (held.length === 0) return `${path} imports ${specifier}, which the commit does not hold`;
    const outside = held.find((c) => !list.has(c));
    if (outside !== undefined) return `${path} imports ${outside} at the commit, not in the list`;
  }
  return null;
}

const isRelative = (specifier: string) =>
  specifier === "." || specifier === ".." || /^\.\.?\//.test(specifier);

const isBuiltin = (specifier: string) => specifier.startsWith("node:") || BUILTINS.has(specifier);

/** The paths a relative `specifier` from `dir` may resolve to, inside the worktree. */
export function candidates(dir: string, specifier: string): RelativePath[] {
  const bare = specifier.replace(/[?#].*$/, "");
  const joined = posix.normalize(posix.join(dir, bare)).replace(/\/$/, "");
  if (joined === ".." || joined.startsWith("../") || joined === ".") return [];
  const extension = posix.extname(joined);
  const out = [joined];
  for (const source of SOURCE_OF[extension] ?? []) {
    out.push(`${joined.slice(0, -extension.length)}${source}`);
  }
  for (const added of EXTENSIONS) out.push(`${joined}${added}`, `${joined}/index${added}`);
  return out;
}

/** The resolution stem of a file a specifier can name: its path without extension or `/index`. */
export function stemOf(path: RelativePath): string | null {
  const extension = posix.extname(path);
  if (!EXTENSIONS.includes(extension)) return null;
  return path.slice(0, -extension.length).replace(/\/index$/, "");
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}
