import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { init, parse } from "es-module-lexer";
import type { ImportGraph } from "../store/import-graph.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import { targetsIn } from "./chains.js";
import type { ModuleFacts } from "./types.js";

/*
 * Spec 015 D11: whether a module is a barrel, a module of imports and
 * re-exports only, read from its bytes with es-module-lexer, which lexes
 * TypeScript. Its `facade` is a module of import and export statements
 * only; a types-only module is one too, so a barrel also needs a value
 * import or re-export. Whether a module exports a runtime value is read
 * from the lexer's `typeOnly` (015-116, P4): `export type`, `interface` and
 * `declare` exports have none; an `enum`, a `namespace` and a value
 * re-export have one. Read only, and only for the modules on a chain.
 */

/** The lexer compiles its WebAssembly once; await before `moduleFacts` answers. */
export const lexerReady: Promise<void> = init();

const LEXED = /\.(?:[mc]?[jt]s|[jt]sx)$/;

interface Lexed {
  readonly barrel: boolean;
  /** Specifiers of `export * from`, not `export type *`. */
  readonly stars: readonly string[];
  /** Some export has a runtime value. */
  readonly value: boolean;
}

function lex(root: AbsolutePath, path: RelativePath): Lexed | null {
  if (!LEXED.test(path)) return null;
  try {
    const [imports, exports, facade] = parse(readFileSync(join(root, path), "utf8"), path);
    const values = imports.filter(
      (i) => (i.type === "static" || i.type === "reexport-star") && !i.typeOnly,
    );
    return {
      barrel: facade && values.length > 0,
      stars: values.flatMap((i) =>
        i.type === "reexport-star" && typeof i.specifier === "string" ? [i.specifier] : [],
      ),
      value: exports.some((e) => !e.typeOnly),
    };
  } catch {
    return null;
  }
}

const bare = (path: string) => path.replace(/\.[^./]+$/, "").replace(/\/index$/, "");

/** The facts of the worktree at `root`, each file read once. */
export function moduleFacts(root: AbsolutePath, graph: ImportGraph | null): ModuleFacts {
  const lexed = new Map<RelativePath, Lexed | null>();
  const of = (path: RelativePath) => {
    if (!lexed.has(path)) lexed.set(path, lex(root, path));
    return lexed.get(path) ?? null;
  };
  const present = new Map<RelativePath, boolean>();
  return {
    barrel: (path) => of(path)?.barrel === true,
    exportsValue: (path) => of(path)?.value ?? null,
    hasBytes(path) {
      let known = present.get(path);
      if (known === undefined) {
        known = existsSync(join(root, path));
        present.set(path, known);
      }
      return known;
    },
    starTargets(path, test) {
      const stars = of(path)?.stars ?? [];
      const walked = graph?.walk(test);
      const targets = walked === undefined ? [] : (targetsIn(walked.imports, path) ?? []);
      const wanted = new Set(
        stars
          .filter((s) => s.startsWith("."))
          .map((s) => bare(posix.normalize(posix.join(posix.dirname(path), s)))),
      );
      return new Set(targets.filter((t) => wanted.has(bare(t))));
    },
  };
}
