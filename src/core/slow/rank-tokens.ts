/**
 * The token rules of spec 004 D2's evidence order (amended 2026-10-18, task
 * 004-72's design, `research/issue-4-signals.md` signal b2). A changed file
 * offers tokens; a slow file and its helpers are matched against them whole.
 */

/**
 * Utility classes most of a page shares; they say nothing about a feature
 * (`research/probes/issue-4-signals/tokens.mjs`).
 */
const UTILITY =
  /^(?:-?(?:m|p|mx|my|px|py|mt|mb|ml|mr|pt|pb|pl|pr|gap|space|w|h|min|max|text|bg|border|rounded|flex|grid|items|justify|self|place|col|row|font|leading|tracking|shadow|ring|outline|opacity|z|top|left|right|bottom|inset|overflow|truncate|whitespace|break|line|sr|not|cursor|select|pointer|transition|duration|ease|animate|translate|scale|rotate|fill|stroke|object|aspect|order|shrink|grow|basis|divide|decoration|underline|list|align|content|size|hover|focus|group|peer|data|aria|dark|sm|md|lg|xl|2xl)-)/;

const HYPHENATED = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const DATA_VALUE = /data-[a-z-]+\s*=\s*\{?\s*['"`]([a-z0-9][a-z0-9-]*)['"`]/gi;
const DATA_SELECTOR = /\[data-[a-z-]+\s*[~^$*|]?=\s*['"]?([a-z0-9][a-z0-9-]*)/gi;
const ARIA_LABEL = /aria-label\s*=\s*\{?\s*['"]([^'"{}\n]{4,60})['"]/g;
const CSS_CLASS = /(?:^|[\s,{(>])\.([a-z][a-z0-9]*(?:-[a-z0-9]+)+)/gm;
const CLASS_ATTRIBUTE = /class(?:Name)?\s*=\s*(?:\{([^}]*)\}|['"`]([^'"`]*)['"`])/g;
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const WORD = /[A-Za-z0-9-]+/g;

/**
 * What a changed file offers: `data-*` attribute values, `aria-label`s and
 * hyphenated class names, utility classes and short ones left out. A class
 * expression (`className={on ? "a-b" : "c-d"}`) offers its string literals'
 * classes.
 */
export function offeredTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const m of text.matchAll(DATA_VALUE)) add(tokens, m[1]);
  for (const m of text.matchAll(DATA_SELECTOR)) add(tokens, m[1]);
  for (const m of text.matchAll(ARIA_LABEL)) add(tokens, m[1]?.trim());
  for (const m of text.matchAll(CSS_CLASS)) add(tokens, m[1]);
  for (const m of text.matchAll(CLASS_ATTRIBUTE)) {
    const classes =
      m[2] ?? [...(m[1] ?? "").matchAll(LITERAL)].map((l) => l[0].slice(1, -1)).join(" ");
    for (const name of classes.split(/\s+/)) {
      if (HYPHENATED.test(name) && name.length >= 8 && !UTILITY.test(name)) tokens.add(name);
    }
  }
  return tokens;
}

function add(tokens: Set<string>, token: string | undefined): void {
  if (token !== undefined && token !== "") tokens.add(token);
}

/** What a slow file or helper can be matched on: the text of its string literals. */
export interface MatchSide {
  /** Every run of letters, digits and hyphens inside a string literal. */
  readonly words: readonly string[];
  /** String literals with a space, for `aria-label` tokens of several words. */
  readonly phrases: readonly string[];
}

/** The most characters of one phrase kept; an `aria-label` token is at most 60. */
const PHRASE_LIMIT = 200;

/**
 * A slow file's side of the match. A selector names a token in a string
 * (`'[data-slot="link-safety-dialog"]'`, `getByLabel("Close dialog")`), so
 * only string literals are read: identifiers and comments match nothing.
 */
export function matchSide(text: string): MatchSide {
  const words = new Set<string>();
  const phrases = new Set<string>();
  for (const m of text.matchAll(LITERAL)) {
    const body = m[0].slice(1, -1);
    for (const w of body.matchAll(WORD)) words.add(w[0]);
    if (body.includes(" ") && body.length <= PHRASE_LIMIT) phrases.add(body);
  }
  return { words: [...words], phrases: [...phrases] };
}

/** Whether `token` occurs whole in `side`: a word, or bounded inside a phrase. */
export function matches(
  token: string,
  words: ReadonlySet<string>,
  phrases: readonly string[],
): boolean {
  if (!token.includes(" ")) return words.has(token);
  return phrases.some((phrase) => bounded(phrase, token));
}

function bounded(hay: string, token: string): boolean {
  for (let at = hay.indexOf(token); at !== -1; at = hay.indexOf(token, at + 1)) {
    const before = hay[at - 1];
    const after = hay[at + token.length];
    if (!continues(before) && !continues(after)) return true;
  }
  return false;
}

function continues(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9-]/.test(char);
}

const IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*['"](\.{1,2}\/[^'"\n]+)['"]/g;

/**
 * Relative import specifiers of `text`: `./` and `../` for a changed file
 * (`parents`), `./` alone for a slow file's own helpers.
 */
export function localSpecifiers(text: string, parents: boolean): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(IMPORT)) {
    const specifier = m[1] as string;
    if (parents || specifier.startsWith("./")) out.push(specifier);
  }
  return out;
}
