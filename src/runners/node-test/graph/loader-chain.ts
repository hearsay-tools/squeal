/**
 * How a node:test project loads modules, read out of its `argv` (spec 003 D3):
 * which resolution rules apply, which preloads run before the tests, and the
 * custom conditions Node resolves with.
 */
export interface LoaderChain {
  /**
   * `tsx`: `--import tsx` or `tsx/esm`, so `.js` may mean `.ts`, extensionless
   * and directory `index` imports resolve, and tsconfig `paths` apply.
   * `node`: Node's own rules, explicit extensions, `.ts` allowed by type
   * stripping; also the fallback when the only loader is one Squeal does not
   * recognize.
   */
  readonly rules: "tsx" | "node";
  /**
   * Every `--import` and `--require` value other than tsx, paths and bare
   * specifiers alike, in order; the graph resolves each from `cwd` (D1, S3).
   */
  readonly preloads: readonly Preload[];
  /** `--conditions` / `-C` values, added to `node` and `import` or `require`. */
  readonly conditions: readonly string[];
  /** `--loader` values, which Squeal does not model, one note each. */
  readonly unrecognized: readonly string[];
}

export interface Preload {
  readonly specifier: string;
  readonly kind: "import" | "require";
  /** Written as a path (`./x.mjs`, `/abs`, `file:`) rather than a package specifier. */
  readonly path: boolean;
}

const TSX = new Set(["tsx", "tsx/esm"]);

/** Flags whose value is the next element unless written `--flag=value`. */
const VALUE_FLAGS: Readonly<Record<string, "import" | "require" | "loader" | "condition">> = {
  "--import": "import",
  "--require": "require",
  "-r": "require",
  "--loader": "loader",
  "--experimental-loader": "loader",
  "--conditions": "condition",
  "-C": "condition",
};

/**
 * Every `--import` or `--require` that is not tsx is a preload; whether a
 * bare one is a project preload or an unrecognized loader depends on where
 * it resolves, which the graph decides (spec 003 D1, `reviews/wave-1.md` S3).
 */
export function readLoaderChain(argv: readonly string[]): LoaderChain {
  let tsx = false;
  const preloads: Preload[] = [];
  const conditions: string[] = [];
  const unrecognized: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const eq = arg.indexOf("=");
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const role = VALUE_FLAGS[flag];
    if (role === undefined) continue;
    const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined) break;
    if (role === "condition") conditions.push(value);
    else if (TSX.has(value)) tsx = true;
    else if (role === "loader") unrecognized.push(value);
    else preloads.push({ specifier: value, kind: role, path: isPath(value) });
  }
  return {
    rules: tsx ? "tsx" : "node",
    preloads,
    conditions,
    unrecognized,
  };
}

const isPath = (specifier: string) =>
  specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("file:");
