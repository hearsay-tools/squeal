// Spec 020 D19 (row 020-26ab): records beside the project's coverage. When
// the run's resolved config has `coverage.enabled` with the V8 provider on
// a Vitest minor Squeal has tested, `coverage.cjs` adds no provider: it
// wraps the project provider's `onAfterSuiteRun`, which Vitest calls in its
// own process once per worker run with the same per-file payload Squeal's
// provider gets (`research/ci-coverage-both.md` Q1). The original runs
// first and its result is returned; an error of Squeal's is a note, never
// the run's. The project's report, reporters, thresholds and exit code stay
// its own. Vitest 5 gives the payload's path, which Squeal reads in place
// (the provider removes it only after the reporters' `onTestRunEnd`);
// Vitest 4.1 gives the payload object, which Squeal writes to its own
// directory. Istanbul, custom and browser-mode providers, and any other
// Vitest version, yield. CommonJS with Node built-ins only.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const clock = require("./clock.cjs");

/** D19.2: the Vitest minors whose V8 provider Squeal has tested records from. */
const TESTED = ["4.1", "5.0"];

const minorOf = (version) => /^(\d+\.\d+)\./.exec(String(version))?.[1] ?? String(version);
const tested = (version) => TESTED.includes(minorOf(version));
const testedText = `Vitest ${TESTED.slice(0, -1).join(", ")} and ${TESTED.at(-1)}, the versions it has tested`;

/**
 * Why Squeal records nothing beside the run's own coverage, before its
 * `start`; `null` when it wraps the project's V8 provider.
 */
function yieldReason(vitest) {
  const provider = vitest.config.coverage.provider ?? "v8";
  if (provider !== "v8") {
    return `the run has coverage of its own with provider ${JSON.stringify(provider)}, from which Squeal records nothing (it reads only the V8 provider's), and a Vitest run takes one coverage provider`;
  }
  if (vitest.projects.some((p) => p.config?.browser?.enabled === true)) {
    return "the run has V8 coverage of its own in browser mode, which Squeal does not read";
  }
  if (!tested(vitest.version)) {
    return `the run has V8 coverage of its own on Vitest ${vitest.version}; Squeal records from it only on ${testedText}`;
  }
  return null;
}

/**
 * The project provider's batches, as Squeal's provider gives them
 * (`takeBatches`): `install` wraps the provider once it exists (the run's
 * start); each batch's payload is a path, and `children` when the payload
 * holds a child process's scripts (`autoAttachSubprocess`, D19.3).
 * `failed` gets each error of Squeal's.
 */
function v8Batches(vitest, dir, failed) {
  const batches = [];
  let made = 0;
  let collector = null;
  const children = vitest.config.coverage.autoAttachSubprocess === true;
  const keep = clock.timed((meta) => {
    try {
      let payload = meta.coverage;
      let result = null;
      if (typeof payload === "object" && payload !== null) {
        // Vitest 4.1: the provider writes the object itself, later; Squeal writes its own copy.
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `v8-${made++}.json`);
        fs.writeFileSync(file, JSON.stringify(payload));
        result = payload.result;
        payload = file;
      }
      if (typeof payload !== "string") throw new Error(`a V8 payload of type ${typeof payload}`);
      if (children) result ??= JSON.parse(fs.readFileSync(payload, "utf8")).result;
      const extended = children && result.some((script) => script.isExtendedContext === true);
      batches.push({ ...meta, coverage: payload, ...(extended ? { children: true } : {}) });
    } catch (error) {
      failed(error);
    }
  });
  return {
    /** Wraps the provider; why it cannot, or `null`. Once. */
    install() {
      if (collector !== null) return null;
      const provider = vitest.coverageProvider;
      if (provider?.name !== "v8" || typeof provider.onAfterSuiteRun !== "function") {
        return `the run's coverage provider is not Vitest's V8 provider (${provider?.name})`;
      }
      if (!tested(provider.version)) {
        return `the run's V8 provider is version ${provider.version}; Squeal records from it only on ${testedText}`;
      }
      const original = provider.onAfterSuiteRun;
      provider.onAfterSuiteRun = function onAfterSuiteRun(meta) {
        const result = original.call(this, meta);
        keep(meta);
        return result;
      };
      collector = { collector: "v8", collectorVersion: String(provider.version) };
      return null;
    },
    /** The batches since the last call. */
    take: () => batches.splice(0),
    /** The header's collector fields, once installed. */
    collector: () => collector,
  };
}

module.exports = { v8Batches, yieldReason };
