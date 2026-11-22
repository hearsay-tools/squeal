// Throwaway prototype (Candidate B): line-preserving runtime-equivalent text of a JS/TS file
// over tree-sitter-tsx 0.23.2. Not product code. See README.md.
import { createHash } from "node:crypto";
import { tsx, typescript } from "./ts.mjs";

export const TS_EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);
export const JS_EXT = new Set([".js", ".jsx", ".mjs", ".cjs"]);

/** Comments whose text changes what a transformer, Vitest or a coverage tool does. */
export const MAGIC =
  /@vitest-environment|@jest-environment|@vite-ignore|[#@]__PURE__|[#@]__NO_SIDE_EFFECTS__|webpack[A-Z][A-Za-z]*|\b(?:v8|c8|istanbul|node:coverage)\s+(?:ignore|disable|enable)|@jsx(?:ImportSource|Frag|Runtime)?\b|^\/\/[#@]\s*source(?:Mapping)?URL=/;

/** Node types that exist only in TypeScript syntax. */
const TS_ONLY = new Set([
  "type_annotation", "type_arguments", "type_parameters", "as_expression", "satisfies_expression",
  "non_null_expression", "type_assertion", "interface_declaration", "type_alias_declaration",
  "ambient_declaration", "function_signature", "abstract_method_signature", "method_signature",
  "index_signature", "implements_clause", "enum_declaration", "internal_module", "module",
  "accessibility_modifier", "abstract_class_declaration", "asserts_annotation",
  "type_predicate_annotation", "import_alias", "instantiation_expression",
]);

const STRINGY = new Set(["string", "regex", "jsx_text", "hash_bang_line"]);
const JSX_ROOT = new Set(["jsx_element", "jsx_self_closing_element", "jsx_fragment"]);

/**
 * Returns { ok, reason?, exact, trim, norm } where `exact` blanks type-only syntax and
 * comments with spaces (every line and column of runtime code stays), `trim` also drops
 * spaces at line ends, and `norm` also collapses horizontal whitespace outside strings, templates, regexes and JSX.
 */
export async function normalize(text, ext) {
  const isTs = TS_EXT.has(ext);
  if (!isTs && !JS_EXT.has(ext)) return { ok: false, reason: "extension" };
  const input = text.replaceAll("\0", " ");
  if (process.env.SQUEAL_PARSER) {
    // Squeal's own parse with its gap rewrites (src/core/code/count/parser.ts); needs `node --import tsx`.
    const squeal = await squealParser();
    return squeal.withCodeTree("typescript", text, (root) => fromTree(root, input, isTs));
  }
  const parser = process.env.TS_GRAMMAR && isTs && ext !== ".tsx" ? await typescript() : await tsx();
  const tree = parser.parse(input);
  try {
    return fromTree(tree.rootNode, input, isTs);
  } finally {
    tree.delete();
  }
}

let squealModule = null;
async function squealParser() {
  if (squealModule) return squealModule;
  const { REPO } = await import("./ts.mjs");
  const m = await import(REPO + "src/core/code/count/parser.ts");
  await m.counterReady();
  squealModule = m;
  return m;
}

/** `export type * from` and `export type * as N from`: the one error shape Squeal's counter accepts. */
function isExportTypeStarGap(error) {
  const next = error.nextSibling?.type;
  return error.text === "type" && error.parent?.type === "export_statement" && (next === "*" || next === "namespace_export");
}

function errorsOf(root) {
  const out = [];
  const walk = (n) => {
    if (n.isError || n.isMissing) out.push(n);
    else if (n.hasError) for (let i = 0; i < n.childCount; i++) walk(n.child(i));
  };
  walk(root);
  return out;
}

function fromTree(root, input, isTs) {
  {
    let gaps = new Set();
    if (root.hasError) {
      const errors = errorsOf(root);
      if (!isTs || !errors.every(isExportTypeStarGap)) return { ok: false, reason: errorReason(input, root) };
      gaps = new Set(errors.map((e) => e.parent.startIndex));
    }
    const blank = []; // [start, end) UTF-16 ranges
    const verbatim = [];
    let fail = null;
    const cut = (n) => blank.push([n.startIndex, n.endIndex]);
    const cutRange = (s, e) => blank.push([s, e]);
    const cutWithSemicolon = (n) => {
      const next = n.nextSibling;
      cutRange(n.startIndex, next?.type === ";" ? next.endIndex : n.endIndex);
    };
    const cutListItem = (n) => {
      // An item of a comma list, with one comma beside it.
      const next = n.nextSibling;
      const prev = n.previousSibling;
      if (next?.type === ",") cutRange(n.startIndex, next.endIndex);
      else if (prev?.type === ",") cutRange(prev.startIndex, n.endIndex);
      else cut(n);
    };
    const childOfType = (n, t) => {
      for (let i = 0; i < n.childCount; i++) if (n.child(i).type === t) return n.child(i);
      return null;
    };
    const visit = (n) => {
      if (fail) return;
      const t = n.type;
      if (t === "comment") {
        if (MAGIC.test(n.text)) fail = "magic-comment";
        else cut(n);
        return;
      }
      if (STRINGY.has(t)) {
        verbatim.push([n.startIndex, n.endIndex]);
        return;
      }
      if (t === "template_string") {
        verbatim.push([n.startIndex, n.endIndex]);
        // Code inside ${} still has types to cut; its whitespace stays verbatim (conservative).
      }
      if (JSX_ROOT.has(t) && !n.parent?.type.startsWith("jsx")) verbatim.push([n.startIndex, n.endIndex]);
      if (!isTs) {
        if (TS_ONLY.has(t) && t !== "accessibility_modifier") {
          fail = "ts-syntax-in-js";
          return;
        }
      } else if (tsNode(n)) return;
      for (let i = 0; i < n.childCount; i++) visit(n.child(i));
    };
    /** Cuts what TypeScript erases at `n`; true when `n` is wholly cut. */
    const tsNode = (n) => {
      const t = n.type;
      const p = n.parent;
      if (t === "enum_declaration") {
        if (childOfType(n, "const")) {
          fail = "const-enum";
          return true;
        }
        return false;
      }
      if (t === "lexical_declaration" || t === "variable_declaration") {
        // `const enum` parses as an enum_declaration inside some shapes; checked above.
      }
      if (
        t === "interface_declaration" || t === "type_alias_declaration" ||
        t === "ambient_declaration" || t === "function_signature"
      ) {
        if (t === "ambient_declaration" && /\bconst\s+enum\b/.test(n.text)) {
          fail = "const-enum";
          return true;
        }
        if (p?.type === "export_statement") cutWithSemicolon(p);
        else cutWithSemicolon(n);
        return true;
      }
      if (t === "export_statement" && (childOfType(n, "type") || gaps.has(n.startIndex))) {
        cutWithSemicolon(n); // export type { A } / export type * from
        return true;
      }
      if (t === "import_statement" && childOfType(n, "type")) {
        cut(n); // import type ...
        return true;
      }
      if (t === "import_specifier" || t === "export_specifier") {
        if (childOfType(n, "type")) {
          cutListItem(n);
          return true;
        }
        return false;
      }
      if (t === "abstract_method_signature" || t === "method_signature" || t === "index_signature") {
        cutWithSemicolon(n);
        return true;
      }
      if (t === "public_field_definition" && (childOfType(n, "declare") || childOfType(n, "abstract"))) {
        cutWithSemicolon(n);
        return true;
      }
      if (
        t === "type_annotation" || t === "type_arguments" || t === "type_parameters" ||
        t === "implements_clause" || t === "asserts_annotation" || t === "type_predicate_annotation"
      ) {
        cut(n);
        return true;
      }
      if (t === "as_expression" || t === "satisfies_expression") {
        visit(n.child(0));
        cutRange(n.child(0).endIndex, n.endIndex);
        return true;
      }
      if (t === "non_null_expression") {
        visit(n.child(0));
        cutRange(n.child(0).endIndex, n.endIndex);
        return true;
      }
      if (t === "type_assertion") {
        cut(n.child(0)); // <T>
        for (let i = 1; i < n.childCount; i++) visit(n.child(i));
        return true;
      }
      if (t === "required_parameter" || t === "optional_parameter") {
        const pattern = n.childForFieldName("pattern");
        if (pattern?.type === "this") {
          cutListItem(n);
          return true;
        }
        // Parameter properties keep their modifiers: they emit `this.x = x`.
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c.type === "?") cut(c);
          else if (c.type === "accessibility_modifier" || c.type === "readonly" || c.type === "override_modifier") continue;
          else visit(c);
        }
        return true;
      }
      if (t === "accessibility_modifier" || t === "override_modifier") {
        cut(n);
        return true;
      }
      if (t === "public_field_definition" || t === "method_definition" || t === "variable_declarator") {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c.type === "readonly" || c.type === "override" || c.type === "?" || c.type === "!") cut(c);
          else visit(c);
        }
        return true;
      }
      if (t === "abstract_class_declaration") {
        cut(n.child(0)); // `abstract`
        for (let i = 1; i < n.childCount; i++) visit(n.child(i));
        return true;
      }
      if (t === "class_heritage") return false;
      return false;
    };
    visit(root);
    if (fail) return { ok: false, reason: fail };
    const exact = applyBlank(input, blank);
    const norm = collapse(exact, verbatim, false);
    const trim = collapse(exact, verbatim, true);
    return { ok: true, exact, trim, norm };
  }
}

function errorReason(input, root) {
  if (/export\s+type\s*\*/.test(input)) return "parse-error:export-type-star";
  if (/import\s*\(/.test(input)) return "parse-error:maybe-import-type";
  return "parse-error";
}

function applyBlank(text, ranges) {
  if (ranges.length === 0) return text;
  const chars = text.split("");
  for (const [s, e] of ranges) for (let i = s; i < e; i++) if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
  return chars.join("");
}

/**
 * Outside verbatim ranges: with `trimOnly`, drops spaces and tabs at line ends (every column
 * of code stays); without, also drops indentation and collapses other runs to one space.
 */
function collapse(text, verbatim, trimOnly) {
  const keep = new Uint8Array(text.length);
  for (const [s, e] of verbatim) keep.fill(1, s, e);
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if ((c === " " || c === "\t") && !keep[i]) {
      let j = i;
      while (j < text.length && (text[j] === " " || text[j] === "\t") && !keep[j]) j++;
      const atStart = i === 0 || text[i - 1] === "\n";
      const atEnd = j === text.length || text[j] === "\n" || text[j] === "\r";
      if (trimOnly) {
        if (!atEnd) out += text.slice(i, j);
      } else if (!atStart && !atEnd) out += " ";
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function digest(ext, body) {
  return createHash("sha256").update(`${ext}\0${body}`).digest("hex");
}
