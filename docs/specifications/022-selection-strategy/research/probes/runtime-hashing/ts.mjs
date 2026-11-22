// Throwaway: loads web-tree-sitter and the vendored tree-sitter-tsx grammar.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";
const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
export const REPO = root;
let parser = null;
export async function tsx() {
  if (parser) return parser;
  await Parser.init({ wasmBinary: readFileSync(root + "node_modules/web-tree-sitter/web-tree-sitter.wasm") });
  const lang = await Language.load(readFileSync(root + "src/core/code/count/tree-sitter-tsx.wasm"));
  parser = new Parser();
  parser.setLanguage(lang);
  return parser;
}
export async function language(path) {
  await tsx();
  return Language.load(readFileSync(path));
}
let tsParser = null;
/** tree-sitter-typescript.wasm from the same 0.23.2 tarball, at TS_GRAMMAR (not vendored). */
export async function typescript() {
  if (tsParser) return tsParser;
  await tsx();
  tsParser = new Parser();
  tsParser.setLanguage(await Language.load(readFileSync(process.env.TS_GRAMMAR)));
  return tsParser;
}
