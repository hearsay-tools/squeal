// Spec 020 D13 (row 020-08a): what `coverage.cjs` reads of the Vitest run to
// keep or drop a test file's record: the project files a module ID names,
// a module's transform, the modules that import `node:inspector` (spec 015
// D8 Fidelity: their tests can see V8 coverage), the files a payload ran,
// and the filters under which no file runs whole (015 D8 keeps a record
// only for a file run whole); and `settle`, each file's record or why it
// has none. CommonJS with Node built-ins only.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

/** A builtin specifier that names the inspector, with or without `node:`. */
const INSPECTOR = /^(?:node:)?inspector(?:\/promises)?$/;
/** A load of it Vite's import analysis does not list. */
const INSPECTOR_LOAD =
  /\b(?:require|getBuiltinModule)\s*\(\s*["'`](?:node:)?inspector(?:\/promises)?["'`]/;

/** The project file a module ID names exactly, or `null`: outside `root`, in `node_modules`, a query. */
function projectFile(id, root) {
  if (typeof id !== "string" || !path.isAbsolute(id) || /[?#\0]/.test(id)) return null;
  const relative = path.relative(root, id);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).includes("node_modules") ? null : relative;
}

/** A module's transform, cached or kept through an invalidation (`cachedTransform`). */
function transformOf(module) {
  if (module?.transformResult) return module.transformResult;
  const state = module?.invalidationState;
  return typeof state === "object" && state !== null ? state : null;
}

/** One file's record, or why none, the inspector rule first. */
async function settle(result, vitest, projectName, inspector, root) {
  if (result === undefined) {
    const project = vitest.projects.find((p) => p.name === projectName);
    const isolate = project?.serializedConfig?.isolate ?? project?.config?.isolate;
    return { none: isolate === false ? "isolate-false" : "unmapped" };
  }
  const mapped = result.mapped === undefined ? null : await result.mapped;
  const ids = inspectorIds(result.environment, inspector, root);
  if (ids.size > 0) {
    const ran = mapped?.record
      ? mapped.record.paths.map((p) => path.join(root, p))
      : payloadFiles(result.payload);
    if (ran.some((file) => ids.has(file))) return { none: "inspector" };
  }
  return mapped ?? { none: result.none };
}

/** The project files of `environment` whose transform imports `node:inspector`, once per environment. */
function inspectorIds(environment, known, root) {
  if (environment === undefined) return new Set();
  let ids = known.get(environment);
  if (ids !== undefined) return ids;
  ids = new Set();
  for (const [id, module] of environment.moduleGraph.idToModuleMap) {
    const transform = transformOf(module);
    if (transform === null || projectFile(id, root) === null) continue;
    const deps = [...(transform.deps ?? []), ...(transform.dynamicDeps ?? [])];
    if (deps.some((dep) => INSPECTOR.test(dep)) || INSPECTOR_LOAD.test(transform.code ?? "")) {
      ids.add(id);
    }
  }
  known.set(environment, ids);
  return ids;
}

/** The files a payload's scripts name; none when it does not read. */
function payloadFiles(payload) {
  try {
    const { result } = JSON.parse(fs.readFileSync(payload, "utf8"));
    return result.flatMap(({ url }) => (url.startsWith("file://") ? [fileURLToPath(url)] : []));
  } catch {
    return [];
  }
}

/** Whether `project`'s runs filter tests by name or tag: then no file runs whole. */
function isFiltered(vitest, project) {
  const pattern =
    vitest.getGlobalTestNamePattern?.() ??
    vitest.configOverride?.testNamePattern ??
    vitest.config?.testNamePattern;
  const tags = (config) => Array.isArray(config?.tagsFilter) && config.tagsFilter.length > 0;
  return (
    Boolean(pattern) ||
    Boolean(project.config?.testNamePattern) ||
    tags(vitest.config) ||
    tags(project.config)
  );
}

module.exports = { isFiltered, projectFile, settle, transformOf };
