import { describe, expect, it } from "vitest";
import { describeFailure, SUMMARY_MAX_CHARS } from "../../../src/core/state/index.js";
import type { CheckError } from "../../../src/core/types/index.js";
import { recorderSignature } from "../../../src/runners/observe/index.js";

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

describe("recorder signatures (task 001-390)", () => {
  it("finds ERR_INVALID_PACKAGE_CONFIG in a child's stderr below the first line", () => {
    const e = error(`${FAILED}Error: Invalid package config /tmp/x/package.json.\n  code: 'X'`);
    expect(recorderSignature(e, true)).toMatch(
      /nearest package\.json \(ERR_INVALID_PACKAGE_CONFIG\)$/,
    );
    expect(
      recorderSignature(error("x", { code: "ERR_INVALID_PACKAGE_CONFIG" }), true),
    ).toBeDefined();
  });

  it("finds an old Node's refusal of --import, in NODE_OPTIONS or argv", () => {
    for (const line of [
      "/opt/node-v18.17.1/bin/node: --import is not allowed in NODE_OPTIONS",
      "node: bad option: --import",
    ]) {
      expect(recorderSignature(error(`${FAILED}${line}`), true)).toBe(
        "Node before 18.18 rejects its --import",
      );
    }
  });

  it("names those two only while the recorder was in NODE_OPTIONS", () => {
    expect(recorderSignature(error(`${FAILED}ERR_INVALID_PACKAGE_CONFIG`), false)).toBeUndefined();
    expect(recorderSignature(error(`${FAILED}bad option: --import`), false)).toBeUndefined();
  });

  it("finds a missing recorder file under --require and --import, in the stack or a cause", () => {
    const required = "Error: Cannot find module '/p/dist/observe/recorder.cjs'";
    const imported =
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/p/dist/node-test/recorder.cjs' imported from /w/";
    expect(recorderSignature(error("Command failed", { stack: required }), false)).toBe(
      "its file is missing",
    );
    const cause = { causes: [{ message: imported }] };
    expect(recorderSignature(error("x", cause), false)).toBe("its file is missing");
    expect(
      recorderSignature(error("Cannot find module '/w/lib/recorder.cjs'"), true),
    ).toBeUndefined();
  });

  it("leaves an ordinary failure alone", () => {
    expect(
      recorderSignature(error("expected 1 to be 0", { stack: "at a.test.ts:1:1" }), true),
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
