import { describe, expect, it, onTestFinished } from "vitest";
import {
  COVERAGE_PROVIDER_VERSION,
  type CoverageRecord,
  decodeRecord,
} from "../../../src/core/code/coverage/index.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../../../src/core/code/store/index.js";
import { startDaemon } from "../../../src/core/daemon/daemon.js";
import type { CheckKey } from "../../../src/core/types/index.js";
import { ON } from "../../code/helpers.js";
import { createFixtureRepo, SLOW, waitFor, withStore } from "../../daemon/helpers.js";

/*
 * Spec 015 D8 (row 015-86): with `coverage.enabled`, the node:test runs a
 * daemon makes anyway leave a record at each test file's result key, as
 * its Vitest runs do (row 015-11).
 */

const lines = (...text: string[]) => `${text.join("\n")}\n`;
const FILES = {
  "squeal.config.json": `${JSON.stringify({
    complexity: { enabled: true },
    coverage: { enabled: true },
    baseline: { onStart: "lookup-then-run-missing" },
    nodeTest: [{ name: "unit", include: ["ntest/*.test.mjs"] }],
  })}\n`,
  "ntest/area.mjs": lines(
    "export function area(w, h) {",
    "  return w * h;",
    "}",
    "export function neverCalled() {",
    '  return "no";',
    "}",
  ),
  "ntest/area.test.mjs": lines(
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { area } from "./area.mjs";',
    'test("area", () => assert.equal(area(2, 3), 6));',
  ),
};

function recordAt(commonDir: string, key: CheckKey): CoverageRecord | null {
  const store = openCodeStore(commonDir, ON, { create: false });
  if (isCodeStoreOpenFailure(store)) return null;
  try {
    const bytes = store.coverage.get({
      resultKey: key,
      providerVersion: COVERAGE_PROVIDER_VERSION,
    });
    return bytes === null ? null : decodeRecord(bytes);
  } finally {
    store.close();
  }
}

describe("coverage records from the daemon's node:test runs (row 015-86)", SLOW, () => {
  it("keeps a record at the node:test file's result key", async () => {
    const repo = createFixtureRepo({ files: FILES });
    onTestFinished(repo.cleanup);
    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(() => daemon.stop("stop-requested").then(() => {}));
    await daemon.ready;
    const record = await waitFor(
      () =>
        withStore(repo, (store) => {
          const row = store.testFileKeys
            .list(repo.worktreeId)
            .find((r) => r.testFile.path === "ntest/area.test.mjs");
          if (row?.key == null || store.results.byKey(row.key, 0).length === 0) return null;
          return recordAt(repo.commonDir, row.key);
        }),
      120_000,
      "a record at the node:test file's result key",
    );
    const area = record.sources.find((s) => s.path === "ntest/area.mjs");
    expect(area?.functions.map((f) => [f[0], f[4]])).toEqual([
      [1, 1],
      [1, 1],
      [4, 0],
    ]);
  });
});
