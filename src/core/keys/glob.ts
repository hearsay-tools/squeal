import type { RelativePath } from "../types/index.js";

/**
 * Compiles a policy `inputs` glob to a regular expression over worktree
 * relative paths.
 *
 * Supported: `*` and `?` within one segment, `**` across zero or more
 * segments, `{a,b}` with nesting, `[abc]`, `[a-z]` and `[!a]`. Dotfiles match
 * like any other file: a fixture the glob names is an input whatever its name.
 * Negation and absolute globs are rejected, so a typo cannot silently match
 * nothing or everything. `node:path`'s `matchesGlob` is experimental on
 * Node 22, hence this small compiler.
 */
export function globToRegExp(glob: string): RegExp {
  if (glob.startsWith("!")) throw new Error(`squeal: negated input glob is not supported: ${glob}`);
  if (glob.startsWith("/")) throw new Error(`squeal: input glob must be relative: ${glob}`);
  const source = glob.startsWith("./") ? glob.slice(2) : glob;
  // "s": a path may contain a newline, and ".+" from "**" must cross it.
  return new RegExp(`^${compile(source, glob)}$`, "s");
}

/** A predicate that is true for paths matching any of `globs`. */
export function createInputMatcher(globs: readonly string[]): (path: RelativePath) => boolean {
  if (globs.length === 0) return () => false;
  const patterns = globs.map(globToRegExp);
  return (path) => patterns.some((pattern) => pattern.test(path));
}

function compile(glob: string, original: string): string {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const char = glob[i] as string;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        const atStart = i === 0 || glob[i - 1] === "/";
        const atEnd = i + 2 === glob.length || glob[i + 2] === "/";
        if (atStart && atEnd) {
          // "**/" matches zero or more whole segments; a trailing "**" one or more.
          if (i + 2 === glob.length) out += ".+";
          else out += "(?:.+/)?";
          i += 3;
          continue;
        }
      }
      out += "[^/]*";
      i += glob[i + 1] === "*" ? 2 : 1;
    } else if (char === "?") {
      out += "[^/]";
      i++;
    } else if (char === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end === -1) throw new Error(`squeal: unclosed [ in input glob: ${original}`);
      let body = glob.slice(i + 1, end);
      const negated = body.startsWith("!");
      if (negated) body = body.slice(1);
      out += `[${negated ? "^/" : ""}${body.replace(/[\\\]]/g, "\\$&")}]`;
      i = end + 1;
    } else if (char === "{") {
      const end = matchingBrace(glob, i, original);
      const alternatives = splitTopLevel(glob.slice(i + 1, end));
      out += `(?:${alternatives.map((alt) => compile(alt, original)).join("|")})`;
      i = end + 1;
    } else {
      out += char.replace(/[.+^$()|\\{}\]]/, "\\$&");
      i++;
    }
  }
  return out;
}

function matchingBrace(glob: string, open: number, original: string): number {
  let depth = 0;
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === "{") depth++;
    else if (glob[i] === "}" && --depth === 0) return i;
  }
  throw new Error(`squeal: unclosed { in input glob: ${original}`);
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") depth--;
    else if (body[i] === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}
