import { describe, expect, it, onTestFinished } from "vitest";
import { COVERAGE_RECORD_VERSION, decodeRecord } from "../../../src/core/code/coverage/record.js";
import type { CoverageRecord } from "../../../src/core/code/coverage/types.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../../../src/core/code/store/open.js";
import { startDaemon } from "../../../src/core/daemon/daemon.js";
import type { CheckKey } from "../../../src/core/types/keys.js";
import { ON } from "../../code/helpers.js";
import { createFixtureRepo, SLOW, waitFor, withStore } from "../../daemon/helpers.js";

/*
 * Spec 015 D8 (row 015-86): with `coverage.enabled`, the node:test runs a
 * daemon makes anyway leave a record at each test file's result key, as
 * its Vitest runs do (row 015-11). Spec 020 D12: with `coverage.children`
 * too, the record holds what the processes the test starts ran.
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
      providerVersion: COVERAGE_RECORD_VERSION,
    });
    return bytes === null ? null : decodeRecord(bytes);
  } finally {
    store.close();
  }
}

/** The children's variant: the test also runs a plain child that imports a source of its own. */
const CHILDREN = {
  ...FILES,
  "squeal.config.json": FILES["squeal.config.json"].replace(
    '"coverage":{"enabled":true}',
    '"coverage":{"enabled":true,"children":true}',
  ),
  "ntest/child-only.mjs": lines("export function childOnly() {", "  return 2;", "}"),
  "ntest/child.mjs": lines(
    'import { childOnly } from "./child-only.mjs";',
    "process.stdout.write(String(childOnly()));",
  ),
  "ntest/area.test.mjs": lines(
    'import assert from "node:assert/strict";',
    'import { execFileSync } from "node:child_process";',
    'import { test } from "node:test";',
    'import { area } from "./area.mjs";',
    'test("area", () => assert.equal(area(2, 3), 6));',
    'test("a child", () => {',
    '  const child = new URL("./child.mjs", import.meta.url);',
    '  assert.equal(execFileSync(process.execPath, [child.pathname], { encoding: "utf8" }), "2");',
    "});",
  ),
};

/** The record at `ntest/area.test.mjs`'s result key, from a daemon over `files`. */
async function storedRecord(files: Readonly<Record<string, string>>): Promise<CoverageRecord> {
  const repo = createFixtureRepo({ files });
  onTestFinished(repo.cleanup);
  const daemon = await startDaemon({ root: repo.root, env: repo.env });
  if ("reason" in daemon) throw new Error(daemon.message);
  onTestFinished(() => daemon.stop("stop-requested").then(() => {}));
  await daemon.ready;
  return waitFor(
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
}

describe("coverage records from the daemon's node:test runs (row 015-86)", SLOW, () => {
  it("holds what a child ran with coverage.children (020 D12)", async () => {
    expect(CHILDREN["squeal.config.json"]).toContain('"children":true');
    const record = await storedRecord(CHILDREN);
    expect(record.sources.map((s) => s.path)).toEqual([
      "ntest/area.mjs",
      "ntest/area.test.mjs",
      "ntest/child-only.mjs",
      "ntest/child.mjs",
    ]);
    const child = record.sources.find((s) => s.path === "ntest/child-only.mjs");
    expect(child?.functions.map((f) => [f[0], f[4]])).toEqual([
      [1, 1],
      [1, 1],
    ]);
  });

  it("keeps a record at the node:test file's result key", async () => {
    const record = await storedRecord(FILES);
    const area = record.sources.find((s) => s.path === "ntest/area.mjs");
    expect(area?.functions.map((f) => [f[0], f[4]])).toEqual([
      [1, 1],
      [1, 1],
      [4, 0],
    ]);
  });
});
