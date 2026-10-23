import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TSX_GRAMMAR_WASM = "tree-sitter-tsx.wasm";

/**
 * The tree-sitter-tsx grammar (spec 015 D3), found relative to `module`, the
 * running code's own file: from a bundled CLI at `<plugin>/dist/cli/`, the
 * plugin's `dist/code/`, where the build copies it; from the TypeScript
 * sources, beside this file (see `README.md`).
 */
export function loadTsxGrammar(module: URL = new URL(import.meta.url)): Uint8Array {
  const grammar = [
    fileURLToPath(new URL(`../code/${TSX_GRAMMAR_WASM}`, module)),
    fileURLToPath(new URL(TSX_GRAMMAR_WASM, module)),
  ].find((path) => existsSync(path));
  if (grammar === undefined) {
    throw new Error(
      `code counter: ${TSX_GRAMMAR_WASM} not found beside ${module.href} or in ../code/`,
    );
  }
  return readFileSync(grammar);
}
