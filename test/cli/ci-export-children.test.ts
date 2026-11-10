import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { decodeBundle } from "../../src/core/store/transfer-bundle.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import { ci, VITEST } from "../ci/fixture.js";
import { createFixtureRepo, type FixtureRepo, waitFor, withStore } from "../daemon/helpers.js";

/*
 * Spec 020 D12.5 (row 020-08b, from 020-10b's notes): the coverage marker
 * holds `coverage.children`, so `squeal ci export` keys with the policy's
 * value, as the daemon does. With the key on, a file the export holds is
 * at the key a daemon in the same checkout gives it.
 */

const SLOW = { timeout: 300_000 } as const;

const POLICY = `${JSON.stringify({
  coverage: { enabled: true, children: true },
  baseline: { onStart: "lookup-then-run-missing" },
})}\n`;

const MATH = "test/math.test.ts";

let repo: FixtureRepo | undefined;
let out: string | undefined;
afterAll(() => {
  repo?.cleanup();
  if (out !== undefined) rmSync(out, { recursive: true, force: true });
});

/** The daemon's key of `test/math.test.ts`, once it has results there. */
async function daemonKey(fixture: FixtureRepo): Promise<CheckKey> {
  const daemon = await startDaemon({ root: fixture.root, env: fixture.env });
  if ("reason" in daemon) throw new Error(daemon.message);
  try {
    await daemon.ready;
    return await waitFor(
      () =>
        withStore(fixture, (store) => {
          const row = store.testFileKeys
            .list(fixture.worktreeId)
            .find((r) => r.testFile.path === MATH);
          return row?.key != null && store.results.byKey(row.key, 0).length > 0 ? row.key : null;
        }),
      180_000,
      `a result at ${MATH}'s key`,
    );
  } finally {
    await daemon.stop("stop-requested");
  }
}

describe("squeal ci export with coverage.children (spec 020 D12.5)", () => {
  it("keys a file at the daemon's key", SLOW, async () => {
    repo = createFixtureRepo({ files: { "squeal.config.json": POLICY } });
    const key = await daemonKey(repo);
    out = mkdtempSync(join(tmpdir(), "squeal-ci-children-"));
    const parts = join(out, "parts");
    const env = { ...repo.env, CI: "true" };

    const recorded = await ci(
      ["record", "--out", parts, "--", process.execPath, VITEST, "run"],
      repo.root,
      env,
    );
    expect(recorded.said).toContain("wrote ");
    const written = join(out, "results.json.gz");
    const exported = await ci(["export", "--parts", parts, "--out", written], repo.root, env);
    expect(exported.code, exported.said).toBe(0);

    const bundle = decodeBundle(readFileSync(written));
    if (typeof bundle === "string") throw new Error(bundle);
    expect(bundle.testFiles.find((f) => f.path === MATH)?.key).toBe(key);
  });
});
