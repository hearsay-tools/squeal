/**
 * Where a JavaScript or TypeScript source is code rather than a comment, a
 * string, a template literal's text or a regular expression (review wave
 * 2, N3), so a scan for `require(` sees only calls. A lexer, not a parser:
 * a `/` after `)`, `]`, an identifier or a number is division, anywhere else
 * a regular expression, and quotes and regular expressions end at a line
 * break, so a wrong guess hides at most the rest of one line.
 */
export function codeAt(source: string): (offset: number) => boolean {
  const ranges = nonCode(source);
  return (offset) => {
    let lo = 0;
    let hi = ranges.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const [start, end] = ranges[mid] as readonly [number, number];
      if (offset < start) hi = mid;
      else if (offset >= end) lo = mid + 1;
      else return false;
    }
    return true;
  };
}

/** A regular expression may follow these, or these keywords; division follows anything else. */
const BEFORE_REGEX = new Set("(,=:[!&|?{};+-*%<>~^".split(""));
const KEYWORDS = new Set(
  "return typeof instanceof in of new delete void throw case do else yield await".split(" "),
);
const WORD = /[\w$]/;

/** Sorted, disjoint `[start, end)` ranges that are not code. */
function nonCode(source: string): (readonly [number, number])[] {
  const ranges: (readonly [number, number])[] = [];
  /** Open `{` per template-literal `${` we are inside, innermost last. */
  const templates: number[] = [];
  /** The last code character that is not whitespace, and the word it ends, if any. */
  let previous = "";
  let word = "";
  let inWord = false;
  let i = 0;
  const lineEnd = (from: number) => {
    const at = source.indexOf("\n", from);
    return at === -1 ? source.length : at;
  };
  /** Past the closing `quote`, a backslash escaping; at a line break when `line`. */
  const close = (from: number, quote: string, line: boolean): number => {
    let j = from;
    while (j < source.length) {
      const char = source[j];
      if (char === "\\") j += 2;
      else if (char === quote) return j + 1;
      else if (line && char === "\n") return j;
      else j++;
    }
    return source.length;
  };
  /** From inside a template's text to the end of the literal or the next `${`. */
  const template = (from: number): number => {
    let j = from;
    while (j < source.length) {
      const char = source[j];
      if (char === "\\") j += 2;
      else if (char === "`") return j + 1;
      else if (char === "$" && source[j + 1] === "{") {
        templates.push(0);
        return j + 2;
      } else j++;
    }
    return source.length;
  };
  /** Past a regular expression's closing `/` and flags. */
  const regex = (from: number): number => {
    let j = from;
    let inClass = false;
    while (j < source.length) {
      const char = source[j];
      if (char === "\\") j += 2;
      else if (char === "\n") return j;
      else if (char === "[" || char === "]") {
        inClass = char === "[";
        j++;
      } else if (char === "/" && !inClass) {
        j++;
        while (j < source.length && WORD.test(source[j] as string)) j++;
        return j;
      } else j++;
    }
    return source.length;
  };

  while (i < source.length) {
    const char = source[i] as string;
    const next = source[i + 1];
    let end = -1;
    if (char === "/" && next === "/") end = lineEnd(i);
    else if (char === "/" && next === "*") {
      const at = source.indexOf("*/", i + 2);
      end = at === -1 ? source.length : at + 2;
    } else if (char === '"' || char === "'") end = close(i + 1, char, true);
    else if (char === "`") end = template(i + 1);
    else if (char === "/" && (BEFORE_REGEX.has(previous) || previous === "" || KEYWORDS.has(word)))
      end = regex(i + 1);
    else if (char === "}" && templates.length > 0 && templates.at(-1) === 0) {
      templates.pop();
      end = template(i + 1);
    }
    if (end !== -1) {
      ranges.push([i, end]);
      i = end;
      // After a string, template or regular expression, a `/` divides; a comment changes nothing.
      const comment = char === "/" && (next === "/" || next === "*");
      if (!comment) previous = "a";
      word = "";
      inWord = false;
      continue;
    }
    if (templates.length > 0) {
      if (char === "{") templates[templates.length - 1] = (templates.at(-1) ?? 0) + 1;
      else if (char === "}") templates[templates.length - 1] = (templates.at(-1) ?? 1) - 1;
    }
    const space = /\s/.test(char);
    if (WORD.test(char)) word = inWord ? word + char : char;
    else if (!space) word = "";
    inWord = WORD.test(char);
    if (!space) previous = char;
    i++;
  }
  return ranges;
}
