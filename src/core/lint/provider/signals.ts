/*
 * Spec 017 D5: which files' findings depend on other files. Read from
 * `calculateConfigForFile`'s JSON, where ESLint writes each plugin as
 * `namespace:name@version` and each rule's severity first.
 */

/** Plugins whose rules read other files (`eslint-provider.md` Q2); the list grows by row. */
const CROSS_FILE_PLUGINS: ReadonlySet<string> = new Set([
  "eslint-plugin-import",
  "eslint-plugin-import-x",
]);

/** The namespaces those plugins are registered under by their own docs. */
const CROSS_FILE_NAMESPACES: ReadonlySet<string> = new Set(["import", "import-x"]);

export interface LintSignals {
  /** `parserOptions.project`, `projectService` or `programs`: typescript-eslint's typed signals. */
  readonly typed: boolean;
  /** An enabled rule of a known cross-file plugin. */
  readonly crossFile: boolean;
}

interface ConfigJson {
  readonly plugins?: readonly string[];
  readonly languageOptions?: { readonly parserOptions?: Readonly<Record<string, unknown>> };
  readonly rules?: Readonly<Record<string, unknown>>;
}

export function lintSignals(config: ConfigJson): LintSignals {
  const options = config.languageOptions?.parserOptions ?? {};
  const typed = Boolean(options.project || options.projectService || options.programs);
  const crossSpaces = new Set(CROSS_FILE_NAMESPACES);
  for (const entry of config.plugins ?? []) {
    const colon = entry.indexOf(":");
    if (colon < 0) continue;
    const named = entry.slice(colon + 1);
    const at = named.lastIndexOf("@");
    if (CROSS_FILE_PLUGINS.has(at > 0 ? named.slice(0, at) : named)) {
      crossSpaces.add(entry.slice(0, colon));
    }
  }
  const crossFile = Object.entries(config.rules ?? {}).some(([id, setting]) => {
    const slash = id.lastIndexOf("/");
    return slash > 0 && crossSpaces.has(id.slice(0, slash)) && enabled(setting);
  });
  return { typed, crossFile };
}

function enabled(setting: unknown): boolean {
  const severity = Array.isArray(setting) ? setting[0] : setting;
  return severity !== 0 && severity !== "off" && severity !== undefined;
}
