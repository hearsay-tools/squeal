/**
 * `NODE_OPTIONS` split into tokens as Node splits it (review wave 2.6, B1):
 * `ParseNodeOptionsEnvVar` in Node's `src/node_options.cc`, the same at
 * v22.23.3 and v24.21.0. Outside double quotes only a space separates; a
 * double quote toggles quoting and is dropped; inside quotes a backslash
 * takes the next character literally, outside it is an ordinary character.
 * A token starts at its first kept character, so `""` alone makes none.
 * `null` where Node reports an error: an unterminated string, or a
 * backslash ending the value inside quotes.
 */
export function tokenizeNodeOptions(value: string): string[] | null {
  const tokens: string[] = [];
  let quoted = false;
  let fresh = true;
  for (let i = 0; i < value.length; i++) {
    let c = value[i] as string;
    if (c === "\\" && quoted) {
      if (i + 1 === value.length) return null;
      c = value[++i] as string;
    } else if (c === " " && !quoted) {
      fresh = true;
      continue;
    } else if (c === '"') {
      quoted = !quoted;
      continue;
    }
    if (fresh) tokens.push(c);
    else tokens[tokens.length - 1] += c;
    fresh = false;
  }
  return quoted ? null : tokens;
}

/** A value as `NODE_OPTIONS` reads it: double quotes, `\\` and `"` escaped. */
export function quoteNodeOption(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

/**
 * Whether Node would run a `--require` preload from this `NODE_OPTIONS`: a
 * token `--require` or `-r`, or one starting `--require=` or `-r=`. True too
 * when the value cannot be tokenized, since an extra recorder only records more.
 */
export function holdsRequire(value: string): boolean {
  const tokens = tokenizeNodeOptions(value);
  if (tokens === null) return true;
  return tokens.some(
    (t) => t === "--require" || t === "-r" || t.startsWith("--require=") || t.startsWith("-r="),
  );
}

/** Each `--loader` and `--experimental-loader` value of a token list, in order. */
export function asyncLoaders(tokens: readonly string[]): string[] {
  const loaders: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const [name, value] = splitFlag(token);
    if (name !== "--loader" && name !== "--experimental-loader") continue;
    const loader = value ?? tokens[++i];
    if (loader !== undefined) loaders.push(loader);
  }
  return loaders;
}

function splitFlag(token: string): readonly [string, string | undefined] {
  const equals = token.indexOf("=");
  return equals === -1 ? [token, undefined] : [token.slice(0, equals), token.slice(equals + 1)];
}
