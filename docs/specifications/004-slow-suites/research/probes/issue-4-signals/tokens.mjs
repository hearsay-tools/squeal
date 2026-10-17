// Throwaway: the token extraction and match shared by signals.mjs and cost.mjs (research/issue-4-signals.md).

// Tokens a page exposes and a browser spec selects: data-* attribute values, aria labels, test ids,
// and hyphenated class names. Matched whole (bounded by characters that cannot continue a token).
export function tokensOf(src) {
  const t = new Set();
  for (const m of src.matchAll(/data-[a-z-]+\s*=\s*\{?\s*['"`]([a-z0-9][a-z0-9-]*)['"`]/gi)) t.add(m[1]);
  for (const m of src.matchAll(/\[data-[a-z-]+\s*[~^$*|]?=\s*['"]?([a-z0-9][a-z0-9-]*)/gi)) t.add(m[1]);
  for (const m of src.matchAll(/aria-label\s*=\s*['"]([^'"{}]{4,60})['"]/g)) t.add(m[1]);
  for (const m of src.matchAll(/(?:^|[\s,{(>])\.([a-z][a-z0-9]*(?:-[a-z0-9]+)+)/gm)) t.add(m[1]);
  for (const m of src.matchAll(/class(?:Name)?\s*=\s*['"`{]([^'"`}]*)/g))
    for (const c of m[1].split(/\s+/)) if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(c) && c.length >= 8 && !TAILWIND.test(c)) t.add(c);
  return t;
}
// Utility classes are shared by most of the page; they say nothing about a feature.
const TAILWIND = /^(?:-?(?:m|p|mx|my|px|py|mt|mb|ml|mr|pt|pb|pl|pr|gap|space|w|h|min|max|text|bg|border|rounded|flex|grid|items|justify|self|place|col|row|font|leading|tracking|shadow|ring|outline|opacity|z|top|left|right|bottom|inset|overflow|truncate|whitespace|break|line|sr|not|cursor|select|pointer|transition|duration|ease|animate|translate|scale|rotate|fill|stroke|object|aspect|order|shrink|grow|basis|divide|decoration|underline|list|align|content|size|hover|focus|group|peer|data|aria|dark|sm|md|lg|xl|2xl)-)/;
export const has = (hay, token) => new RegExp(`(^|[^A-Za-z0-9-])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9-])`).test(hay);
