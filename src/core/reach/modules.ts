import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { init, parse } from "es-module-lexer";
import type { ImportGraph } from "../store/import-graph.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import { targetsOf } from "./chains.js";
import type { ModuleFacts } from "./types.js";

/*
 * Spec 015 D11: whether a module is a barrel, a module of imports and
 * re-exports only, read from its bytes with es-module-lexer, which lexes
 * TypeScript. Its `facade` is a module of import and export statements
 * only; a types-only module is one too, so a barrel also needs a value
 * import or re-export. Read only, and only for the modules on a chain.
 */

/** The lexer compiles its WebAssembly once; await before `moduleFacts` answers. */
export const lexerReady: Promise<void> = init();

const LEXED = /\.(?:[mc]?[jt]s|[jt]sx)$/;

interface Lexed {
  readonly barrel: boolean;
  /** Specifiers of `export * from`, not `export type *`. */
  readonly stars: readonly string[];
}

function lex(root: AbsolutePath, path: RelativePath): Lexed | null {
  if (!LEXED.test(path)) return null;
  try {
    const [imports, , facade] = parse(readFileSync(join(root, path), "utf8"), path);
    const values = imports.filter(
      (i) => (i.type === "static" || i.type === "reexport-star") && !i.typeOnly,
    );
    return {
      barrel: facade && values.length > 0,
      stars: values.flatMap((i) =>
        i.type === "reexport-star" && typeof i.specifier === "string" ? [i.specifier] : [],
      ),
    };
  } catch {
    return null;
  }
}

const bare = (path: string) => path.replace(/\.[^./]+$/, "").replace(/\/index$/, "");

/** The facts of the worktree at `root`; `functions` from the code store, `null` without it. */
export function moduleFacts(
  root: AbsolutePath,
  graph: ImportGraph | null,
  functions: (path: RelativePath) => number | null,
): ModuleFacts {
  const lexed = new Map<RelativePath, Lexed | null>();
  const of = (path: RelativePath) => {
    if (!lexed.has(path)) lexed.set(path, lex(root, path));
    return lexed.get(path) ?? null;
  };
  return {
    barrel: (path) => of(path)?.barrel === true,
    starTargets(path) {
      const stars = of(path)?.stars ?? [];
      const targets = graph === null ? [] : (targetsOf(graph, path) ?? []);
      const wanted = new Set(
        stars
          .filter((s) => s.startsWith("."))
          .map((s) => bare(posix.normalize(posix.join(posix.dirname(path), s)))),
      );
      return new Set(targets.filter((t) => wanted.has(bare(t))));
    },
    functions,
  };
}
