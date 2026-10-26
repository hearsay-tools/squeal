import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** The two WebAssembly files the Python parser loads (spec 007 D4). */
export interface PythonParserWasm {
  /** web-tree-sitter's own runtime. */
  readonly runtime: Uint8Array;
  /** The tree-sitter-python grammar, vendored beside this file (see `README.md`). */
  readonly grammar: Uint8Array;
}

export const RUNTIME_WASM = "web-tree-sitter.wasm";
export const GRAMMAR_WASM = "tree-sitter-python.wasm";

/**
 * Finds both files relative to `module`, the running code's own file: from
 * a bundled CLI at `<plugin>/dist/cli/`, the plugin's `dist/pytest/`, where
 * the build copies them as it copies node:test's runtime files; from the
 * TypeScript sources, the grammar beside this file and the runtime in the
 * installed `web-tree-sitter`.
 */
export function loadWasm(module: URL = new URL(import.meta.url)): PythonParserWasm {
  const bundled = new URL("../pytest/", module);
  const runtime = [fileURLToPath(new URL(RUNTIME_WASM, bundled)), ...installedRuntime(module)].find(
    (path) => existsSync(path),
  );
  const grammar = [
    fileURLToPath(new URL(GRAMMAR_WASM, bundled)),
    fileURLToPath(new URL(GRAMMAR_WASM, module)),
  ].find((path) => existsSync(path));
  if (runtime === undefined || grammar === undefined) {
    throw new Error(
      `Python parser: ${runtime === undefined ? RUNTIME_WASM : GRAMMAR_WASM} not found beside ${module.href} or in ${bundled.href}`,
    );
  }
  return { runtime: readFileSync(runtime), grammar: readFileSync(grammar) };
}

function installedRuntime(module: URL): string[] {
  try {
    return [createRequire(module).resolve(`web-tree-sitter/${RUNTIME_WASM}`)];
  } catch {
    return [];
  }
}
