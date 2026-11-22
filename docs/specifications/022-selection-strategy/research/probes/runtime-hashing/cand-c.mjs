// Throwaway prototype (Candidate C): sucrase 3.35.1 (pure JS, installed only under $TMPDIR at
// SUCRASE_DIR, never in package.json) for types, then acorn's tokenizer to blank comments.
import { createRequire } from "node:module";
import { normalizeA } from "./cand-a.mjs";
import { TS_EXT } from "./strip.mjs";

const { transform } = createRequire(`${process.env.SUCRASE_DIR}/package.json`)("sucrase");
export function normalizeC(text, ext) {
  let js = text;
  const transforms = [];
  if (TS_EXT.has(ext)) transforms.push("typescript");
  if (ext === ".tsx" || ext === ".jsx") transforms.push("jsx");
  if (transforms.length) {
    try {
      js = transform(text, { transforms, disableESTransforms: true, keepUnusedImports: true, filePath: `x${ext}` }).code;
    } catch (e) {
      return { ok: false, reason: `sucrase:${String(e.message).slice(0, 40)}` };
    }
  }
  if (js.split("\n").length !== text.split("\n").length) return { ok: false, reason: "lines-moved" };
  return normalizeA(js, ext === ".tsx" || ext === ".jsx" ? ".js" : ext === ".cts" ? ".cjs" : ".mjs");
}
