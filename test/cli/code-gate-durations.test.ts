import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { storedDurations } from "../../src/cli/code-gate-durations.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { result } from "../store/helpers.js";
import { repo } from "./code-gate-fixture.js";

/*
 * Spec 020 D17 (row 020-17ab): `squeal code --base` reads each selected
 * file's duration from the main store, read-only: the whole file's time of
 * its newest results, at any key. No store gives no durations.
 */

const file = (testPath: string) => ({ kind: "file", project: "", testPath }) as const;
const test = (testPath: string, fullName: string) =>
  ({ kind: "test", project: "", testPath, fullName }) as const;

describe("storedDurations", () => {
  it("is null with no store", () => {
    expect(storedDurations(repo() as AbsolutePath)).toBeNull();
  });

  it("gives a file's newest whole-file seconds, null for a file never stored, and writes nothing", () => {
    const root = repo() as AbsolutePath;
    const commonDir = join(root, ".git") as AbsolutePath;
    const store = openStore(commonDir);
    if (isStoreOpenFailure(store)) throw new Error(store.reason);
    const at = (r: ReturnType<typeof result>, ms: number, recordedAt: number) => ({
      ...r,
      durationMs: ms,
      provenance: { ...r.provenance, recordedAt },
    });
    store.results.putMany([
      at(result(file("test/a.test.ts"), "old"), 90_000, 1_000),
      at(result(file("test/a.test.ts"), "new"), 41_200, 2_000),
      // A file-level check an older daemon stored holds less than its tests: the file reads their sum.
      at(result(file("test/b.test.ts"), "k"), 1_000, 1_000),
      at(result(test("test/b.test.ts", "one"), "k"), 2_000, 1_000),
      at(result(test("test/b.test.ts", "two"), "k"), 3_000, 1_000),
    ]);
    store.close();
    const hash = () =>
      createHash("sha256")
        .update(readFileSync(storePaths(commonDir).database))
        .digest("hex");
    const before = hash();

    const durations = storedDurations(root);
    try {
      expect(durations?.of({ project: "", path: "test/a.test.ts" })).toBe(41.2);
      expect(durations?.of({ project: "", path: "test/b.test.ts" })).toBe(5);
      expect(durations?.of({ project: "", path: "test/c.test.ts" })).toBeNull();
      expect(durations?.of({ project: "other", path: "test/a.test.ts" })).toBeNull();
    } finally {
      durations?.close();
    }
    expect(hash()).toBe(before);
  });
});
