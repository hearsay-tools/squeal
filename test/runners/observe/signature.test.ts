import { describe, expect, it } from "vitest";
import { describeFailure, SUMMARY_MAX_CHARS } from "../../../src/core/state/index.js";
import type { CheckError } from "../../../src/core/types/index.js";
import { type RecorderUse, recorderSignature } from "../../../src/runners/observe/index.js";

/* Task 001-390, spec 001 D11 Fidelity: a failure with a recorder signature says it ran under it. */

const error = (message: string, more: Partial<CheckError> = {}): CheckError => ({
  name: "Error",
  message,
  stack: null,
  location: null,
  diff: null,
  ...more,
});

const FAILED = "Command failed: node child.cjs\n";
const RECORDER = "/p/dist/observe/recorder.cjs";
/** The recorder in the run's `NODE_OPTIONS`, as an observing Vitest run has it; `/w` the worktree. */
const OBSERVING: RecorderUse = {
  files: [RECORDER],
  inNodeOptions: true,
  relativize: (text) => text.replaceAll("/w/", ""),
};
const IN_ARGV: RecorderUse = { ...OBSERVING, inNodeOptions: false };
const NONE: RecorderUse = { ...OBSERVING, files: [], inNodeOptions: false };

/** A child's stderr after Node 24 or 22 failed parsing `bad/package.json` at a `--require` preload (probe, review 001-401). */
const PRELOAD_24 = `Error: Invalid package config /tmp/x/bad/package.json.
    at Object.getNearestParentPackageJSON (node:internal/modules/package_json_reader:197:35)
    at trySelf (node:internal/modules/cjs/loader:662:33)
    at Module._resolveFilename (node:internal/modules/cjs/loader:1548:24)
    at Module._load (node:internal/modules/cjs/loader:1341:5)
    at Module.require (node:internal/modules/cjs/loader:1674:12)
    at node:internal/modules/cjs/loader:2221:12 {
  code: 'ERR_INVALID_PACKAGE_CONFIG'`;
const PRELOAD_22 = `Error: Invalid package config /tmp/x/bad/package.json.
    at trySelf (node:internal/modules/cjs/loader:613:33)
    at Function._load (node:internal/modules/cjs/loader:1216:25)
    at Module.require (node:internal/modules/cjs/loader:1527:12)
    at node:internal/modules/cjs/loader:2071:12
    at loadPreloadModules (node:internal/process/pre_execution:756:5) {`;
/** The same error from a project's own load of a module beneath it, or its own `require`. */
const LOADED = `Error: Invalid package config /tmp/x/bad/package.json.
    at Object.getNearestParentPackageJSON (node:internal/modules/package_json_reader:197:35)
    at Object..js (node:internal/modules/cjs/loader:2033:29)
    at Module.load (node:internal/modules/cjs/loader:1651:32)
    at require (node:internal/modules/helpers:157:16)
    at Object.<anonymous> (/tmp/x/main.cjs:1:1) {
  code: 'ERR_INVALID_PACKAGE_CONFIG'`;
const REQUIRED = `Error: Invalid package config /tmp/x/bad/package.json.
    at trySelf (node:internal/modules/cjs/loader:662:33)
    at Module._load (node:internal/modules/cjs/loader:1341:5)
    at Module.require (node:internal/modules/cjs/loader:1674:12)
    at require (node:internal/modules/helpers:157:16)
    at Object.<anonymous> (/tmp/x/bad/main.cjs:1:1)`;

describe("recorder signatures (task 001-390, review 001-401)", () => {
  it("finds ERR_INVALID_PACKAGE_CONFIG raised at a --require preload, below a child's first line", () => {
    for (const stderr of [PRELOAD_24, PRELOAD_22]) {
      expect(recorderSignature(error(`${FAILED}${stderr}`), OBSERVING)).toMatch(
        /nearest package\.json \(ERR_INVALID_PACKAGE_CONFIG\)$/,
      );
    }
  });

  it("leaves ERR_INVALID_PACKAGE_CONFIG of a project's own load alone", () => {
    for (const stderr of [LOADED, REQUIRED]) {
      expect(recorderSignature(error(`${FAILED}${stderr}`), OBSERVING)).toBeUndefined();
    }
    expect(
      recorderSignature(error("x", { code: "ERR_INVALID_PACKAGE_CONFIG" }), OBSERVING),
    ).toBeUndefined();
  });

  it("finds an old Node's refusal of --import, in NODE_OPTIONS or argv", () => {
    for (const line of [
      "/opt/node-v18.17.1/bin/node: --import is not allowed in NODE_OPTIONS",
      "node: bad option: --import",
    ]) {
      expect(recorderSignature(error(`${FAILED}${line}`), OBSERVING)).toBe(
        "Node before 18.18 rejects its --import",
      );
    }
  });

  it("names those two only while the recorder was in NODE_OPTIONS", () => {
    expect(recorderSignature(error(`${FAILED}${PRELOAD_24}`), IN_ARGV)).toBeUndefined();
    expect(recorderSignature(error(`${FAILED}bad option: --import`), IN_ARGV)).toBeUndefined();
  });

  it("finds a missing recorder file the run used, under --require and --import, in the stack or a cause", () => {
    const required = `Error: Cannot find module '${RECORDER}'`;
    const imported = `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '${RECORDER}' imported from /w/`;
    expect(recorderSignature(error("Command failed", { stack: required }), IN_ARGV)).toBe(
      "its file is missing",
    );
    const cause = { causes: [{ message: imported }] };
    expect(recorderSignature(error("x", cause), OBSERVING)).toBe("its file is missing");
    // a recorder inside the worktree, as the runner relativized its path
    const inside = { ...OBSERVING, files: ["/w/src/runners/observe/recorder.cjs"] };
    const relative = "Cannot find module 'src/runners/observe/recorder.cjs'";
    expect(recorderSignature(error(relative), inside)).toBe("its file is missing");
  });

  it("never names a project file that only shares the recorder's name, nor a run without a recorder", () => {
    for (const path of [
      "/w/src/observe/recorder.cjs",
      "src/observe/recorder.cjs",
      "/q/dist/observe/recorder.cjs",
    ]) {
      expect(recorderSignature(error(`Cannot find module '${path}'`), OBSERVING)).toBeUndefined();
    }
    const missing = error(`Cannot find module '${RECORDER}'\n${PRELOAD_24}\nbad option: --import`);
    expect(recorderSignature(missing, NONE)).toBeUndefined();
  });

  it("leaves an ordinary failure alone", () => {
    expect(
      recorderSignature(error("expected 1 to be 0", { stack: "at a.test.ts:1:1" }), OBSERVING),
    ).toBe(undefined);
  });

  it("puts the note in the summary, which keeps its room, and not in the fingerprint", () => {
    const plain = error(`${"x".repeat(400)}\nbad option: --import`);
    const signed = { ...plain, recorder: "Node before 18.18 rejects its --import" };
    const before = describeFailure([plain], null);
    const after = describeFailure([signed], null);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(after.summary).toMatch(
      /; ran under Squeal's recorder in NODE_OPTIONS: Node before 18\.18 rejects its --import$/,
    );
    expect(before.summary).not.toContain("recorder");
  });
});
