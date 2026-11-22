// Throwaway prototype (Candidate A): node:module stripTypeScriptTypes, then acorn's tokenizer
// to blank comments. Not product code. See README.md.
import * as acorn from "acorn";
import { stripTypeScriptTypes } from "node:module";
import { MAGIC, TS_EXT } from "./strip.mjs";

export function normalizeA(text, ext) {
  let js = text;
  if (TS_EXT.has(ext)) {
    if (ext === ".tsx") return { ok: false, reason: "tsx-unsupported" };
    try {
      js = stripTypeScriptTypes(text, { mode: "strip" });
    } catch (e) {
      return { ok: false, reason: `strip:${e.code}` };
    }
  }
  if (ext === ".jsx") return { ok: false, reason: "jsx-unsupported" };
  const comments = [];
  try {
    const sourceType = ext === ".cjs" || ext === ".cts" ? "script" : "module";
    for (const _ of acorn.tokenizer(js, {
      ecmaVersion: "latest", sourceType, allowHashBang: true, allowReturnOutsideFunction: true,
      onComment: (block, body, start, end) => comments.push([start, end, body]),
    }));
  } catch (e) {
    return { ok: false, reason: `acorn:${String(e.message).replace(/\s*\(\d+:\d+\)$/, "").slice(0, 40)}` };
  }
  if (comments.some(([s, e]) => MAGIC.test(js.slice(s, e)))) return { ok: false, reason: "magic-comment" };
  const chars = js.split("");
  for (const [s, e] of comments) for (let i = s; i < e; i++) if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
  return { ok: true, exact: chars.join("") };
}
