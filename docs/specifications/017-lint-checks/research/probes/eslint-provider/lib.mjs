// Throwaway probe (017-01). Finds and loads the ESLint a project installed,
// the way eslint_d does: resolve `eslint/package.json` from the project root.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export async function loadProjectESLint(root) {
  const require = createRequire(join(root, "package.json"));
  const pkgPath = require.resolve("eslint/package.json");
  const version = JSON.parse(readFileSync(pkgPath, "utf8")).version;
  const mod = await import(pathToFileURL(require.resolve("eslint")).href);
  // loadESLint exists since 8.57; it picks flat or eslintrc as the CLI would.
  const ESLint = mod.loadESLint ? await mod.loadESLint({ cwd: root }) : mod.ESLint;
  return { ESLint, version, base: dirname(pkgPath) };
}

export function sha(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

// What a key would hold from ESLint itself: the computed config's JSON.
export async function configFacts(eslint, file) {
  const config = await eslint.calculateConfigForFile(file);
  if (config === undefined) return { ignored: true };
  // Config#toJSON writes plugins as `namespace:name@version` and the parser
  // as `name@version` (lib/config/config.js).
  const json = JSON.stringify(config);
  const parsed = JSON.parse(json);
  const po = parsed.languageOptions?.parserOptions ?? {};
  return {
    ignored: false,
    configHash: sha(json),
    typed: Boolean(po.project || po.projectService || po.programs),
    plugins: parsed.plugins,
    parser: parsed.languageOptions?.parser ?? null,
    json,
  };
}

export function findings(results) {
  return results.map((r) => ({
    file: r.filePath,
    messages: r.messages.map((m) => `${m.ruleId}|${m.message}`).sort(),
  }));
}
