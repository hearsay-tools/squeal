// Spec 020 D13 (row 020-08a): Squeal's coverage provider in the Vitest run
// `squeal ci record` wraps. `vitest-ci.cjs` calls `startCoverage` in its
// `start` wrap, before the original `start`, which is where Vitest 4.1 and 5
// call `initCoverageProvider()`; every worker reads the override through the
// project's serialized config. As the daemon's adapter does (spec 015 D8):
// the provider file is allowed in each Vite server (row 013-08), each plugin
// container's `load` stamps the bytes Vite read (`SourceStamps`), and each
// completed whole file's payload is mapped, from the transforms the run
// executed, by the records' worker (`coverage-map.mjs`, `workerMapper`'s
// protocol), one job at a time, as files end.
//
// It adds nothing when the run's resolved config has `coverage.enabled`
// (a Vitest run takes one provider, and replacing the project's turns off
// its report and thresholds) or when this Node lacks
// `process.getBuiltinModule`, which the provider needs. No record for a
// filtered file, a worker batch of several files, a project with
// `isolate: false`, or a file whose worker ran a module that imports
// `node:inspector`, known only after the run. Every error of its own is a
// reason in the part; none reaches the run.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  inspectorIds,
  isFiltered,
  payloadFiles,
  projectFile,
  transformOf,
} = require("./coverage-drops.cjs");
const { startMapper } = require("./map-client.cjs");

const message = (error) => String(error?.message ?? error);
const keyOf = (project, moduleId) => `${project}\0${moduleId}`;

/** The run's coverage when the provider is not in it. */
function offCoverage(off, note) {
  return {
    runStart() {},
    take() {},
    end: () => Promise.resolve({ header: { off, note }, files: new Map() }),
  };
}

/**
 * The coverage of `vitest`'s runs, set up before its `start`; `settings`
 * from `SQUEAL_CI_RECORD`: `provider`, `worker` (`script`, `execArgv`),
 * `dir`, `root`, `format`, or `off` and `note` when `ci record` has none.
 */
function startCoverage(vitest, settings) {
  if (typeof settings?.off === "string") return offCoverage(settings.off, String(settings.note));
  if (typeof settings?.provider !== "string" || typeof settings.worker?.script !== "string") {
    return offCoverage("no-provider", "ci record gave the hook no coverage settings");
  }
  if (typeof process.getBuiltinModule !== "function") {
    const why = `Node ${process.version} has no process.getBuiltinModule, which Squeal's provider needs`;
    return offCoverage("no-provider", why);
  }
  try {
    if (vitest.config?.coverage?.enabled === true) {
      const why =
        "the run has coverage of its own (coverage.enabled), and a Vitest run takes one coverage provider";
      return offCoverage("project-coverage", why);
    }
    return onCoverage(vitest, settings);
  } catch (error) {
    return offCoverage("failed", message(error));
  }
}

function onCoverage(vitest, settings) {
  const override = vitest.configOverride;
  if (typeof override !== "object" || override === null) {
    throw new Error("the Vitest instance has no configOverride");
  }
  const dir = path.join(settings.dir, String(process.pid));
  const before = override.coverage;
  const stamps = new WeakMap();
  try {
    override.coverage = {
      enabled: true,
      provider: "custom",
      customProviderModule: settings.provider,
      reporter: [],
      reportsDirectory: dir,
      coverageFilesDirectory: path.join(dir, ".tmp"),
      clean: false,
    };
    allow(vitest, settings.provider);
    attachStamps(vitest, settings.root, stamps);
  } catch (error) {
    override.coverage = before;
    throw error;
  }
  return runCoverage(vitest, settings, stamps);
}

/** Row 013-08: each Vite server of the instance may load the provider, by its path and real path. */
function allow(vitest, provider) {
  const files = new Set([provider, fs.realpathSync.native(provider)]);
  for (const server of new Set([vitest.vite, ...vitest.projects.map((p) => p.vite)])) {
    const allowed = server.config.server.fs.allow;
    for (const file of files) if (!allowed.includes(file)) allowed.push(file);
  }
}

function environmentsOf(vitest) {
  return new Set(vitest.projects.flatMap((p) => Object.values(p.vite.environments ?? {})));
}

/** As `SourceStamps.attach`: the sha1 of the bytes each container's `load` read, by module ID. */
function attachStamps(vitest, root, stamps) {
  for (const environment of environmentsOf(vitest)) {
    const container = environment.pluginContainer;
    if (stamps.has(container)) continue;
    const reads = new Map();
    stamps.set(container, reads);
    const load = container.load.bind(container);
    container.load = async (id, ...rest) => {
      if (projectFile(id, root) !== null) {
        try {
          reads.set(
            id,
            createHash("sha1")
              .update(await fs.promises.readFile(id))
              .digest("hex"),
          );
        } catch {
          reads.delete(id);
        }
      }
      return load(id, ...rest);
    };
  }
}

function runCoverage(vitest, settings, stamps) {
  const { root, provider } = settings;
  const filtered = new Set();
  const results = new Map();
  const sourceIds = new Map();
  let mapper = null;
  let note;
  const failed = (error) => {
    note ??= message(error);
  };
  const mapperNow = () => {
    mapper ??= startMapper(settings, failed);
    return mapper;
  };
  /** What the run executed of `file` in `environment`, as `workerMapper` gives it; `null` for none. */
  const sourceOf = (environment, file) => {
    if (file === provider) return null;
    const relative = projectFile(file, root);
    const transform = transformOf(environment.moduleGraph.idToModuleMap.get(file));
    if (relative === null || transform === null || typeof transform.code !== "string") return null;
    const map = transform.map ?? null;
    return {
      path: relative,
      code: transform.code,
      map:
        map === null
          ? null
          : { mappings: map.mappings, sourcesContent: map.sourcesContent ?? null },
      sha1: stamps.get(environment.pluginContainer)?.get(file),
    };
  };
  const take = () => {
    try {
      for (const batch of vitest.coverageProvider?.takeBatches?.() ?? []) submit(batch);
    } catch (error) {
      failed(error);
    }
  };
  const submit = (batch) => {
    const project = vitest.projects.find((p) => p.name === batch.projectName);
    const environment = project?.vite.environments[batch.environment];
    // Row 013-10: Vitest names the file from its project's root.
    const ids = batch.testFiles.map((f) => (project ? path.resolve(project.config.root, f) : f));
    const keys = ids.map((id) => keyOf(batch.projectName, id));
    const payload = batch.coverage;
    if (ids.length !== 1 || project === undefined || environment === undefined) {
      for (const key of keys) results.set(key, { none: "not-whole", payload, environment });
      return;
    }
    const [key] = keys;
    if (filtered.has(key) || isFiltered(vitest, project)) {
      results.set(key, { none: "filtered", payload, environment });
      return;
    }
    const relative = projectFile(ids[0], root);
    if (!sourceIds.has(environment)) sourceIds.set(environment, sourceIds.size);
    const job = {
      testFile: { project: batch.projectName, path: relative ?? ids[0] },
      payload,
      sources: sourceIds.get(environment),
      source: (file) => sourceOf(environment, file),
    };
    let mapped;
    try {
      mapped = mapperNow().map(job);
    } catch (error) {
      mapped = Promise.reject(error);
    }
    const unmapped = (error) => {
      failed(error);
      return { none: "unmapped" };
    };
    results.set(key, {
      mapped: mapped.then((record) => ({ record }), unmapped),
      payload,
      environment,
    });
  };
  return {
    /** The files a filter runs only part of (Vitest 4.1 and 5 `TestSpecification`). */
    runStart(specifications) {
      try {
        for (const spec of specifications ?? []) {
          const partial =
            (spec.testLines?.length ?? 0) > 0 ||
            (spec.testIds?.length ?? 0) > 0 ||
            Boolean(spec.testNamePattern) ||
            (spec.testTagsFilter?.length ?? 0) > 0;
          if (partial) filtered.add(keyOf(spec.project.name, spec.moduleId));
        }
      } catch (error) {
        failed(error);
      }
    },
    take,
    /** After the run: each of `modules`' records or why it has none, and the header. */
    async end(modules) {
      try {
        take();
        const files = new Map();
        const inspector = new Map();
        for (const { project, moduleId } of modules) {
          const key = keyOf(project, moduleId);
          const result = results.get(key);
          files.set(key, await settle(result, vitest, project, inspector, root));
        }
        return { header: note === undefined ? { on: true } : { on: true, note }, files };
      } catch (error) {
        // The provider was in the run: every file reads `unmapped`, the error the note.
        failed(error);
        return { header: { on: true, note }, files: new Map() };
      } finally {
        await mapper?.close().catch(() => {});
      }
    },
  };
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

/** The coverage header of a run whose coverage threw outside `end`. */
function failedCoverage(error) {
  return { header: { off: "failed", note: message(error) }, files: new Map() };
}

module.exports = { startCoverage, failedCoverage };
