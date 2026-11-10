import { describe, expect, it, onTestFinished } from "vitest";
import { readSummary } from "../../../src/core/code/crap/summary.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../../../src/core/code/store/open.js";
import { startDaemon } from "../../../src/core/daemon/daemon.js";
import { createFixtureRepo, SLOW, waitFor } from "../../daemon/helpers.js";
import { ON } from "../helpers.js";

/*
 * Spec 020 D12 item 6 (row 020-10b): with `coverage.children`, a function
 * that only a process a test starts runs reads covered in the daemon. The
 * test file does not import its file; the child does. The child inherits
 * the runtime-input recorder, so the test file's observed set holds the
 * file, and with `observe.runtimeInputs` that set is part of the key's
 * closure (016 D4): the test file is its loader through the closure, with
 * no edge of its own in `crap/loaders.ts` (the coordinator, 2026-11-10,
 * request 76f5e57b). With observation off there is no observed set, so
 * no test file loads it. `src/both.mjs` is imported by the test file too,
 * and only the child calls `both`: two processes' records of one function
 * merge into one that ran (request 7665085b).
 */

const lines = (...text: string[]) => `${text.join("\n")}\n`;

const FILES = {
  "src/child-only.mjs": lines(
    "export function childOnly(x) {",
    '  return x > 1 ? "big" : "small";',
    "}",
  ),
  "src/both.mjs": lines(
    "export function both(x) {",
    "  return x > 1 ? 1 : 0;",
    "}",
    'export const NAME = "both";',
  ),
  "bin/child.mjs": lines(
    'import { both } from "../src/both.mjs";',
    'import { childOnly } from "../src/child-only.mjs";',
    "process.stdout.write(childOnly(Number(process.argv[2])) + both(3));",
  ),
  "test/child.test.ts": lines(
    'import { execFileSync } from "node:child_process";',
    'import { fileURLToPath } from "node:url";',
    'import { expect, it } from "vitest";',
    'import { NAME } from "../src/both.mjs";',
    'it("runs a child", () => {',
    '  const bin = fileURLToPath(new URL("../bin/child.mjs", import.meta.url));',
    '  expect(execFileSync(process.execPath, [bin, "3"], { encoding: "utf8" })).toBe("big1");',
    '  expect(NAME).toBe("both");',
    "});",
  ),
};

const SOURCES = ["src/both.mjs", "src/child-only.mjs"];

const policy = (children: boolean, runtimeInputs: boolean) =>
  `${JSON.stringify({
    complexity: { enabled: true },
    coverage: { enabled: true, children },
    observe: { runtimeInputs },
    baseline: { onStart: "lookup-then-run-missing" },
  })}\n`;

/**
 * The coverage states of the two sources once the test file's run is
 * judged; a file not judged reads its state and cause.
 */
async function judged(children: boolean, runtimeInputs = true): Promise<readonly string[]> {
  const repo = createFixtureRepo({
    files: { ...FILES, "squeal.config.json": policy(children, runtimeInputs) },
  });
  onTestFinished(repo.cleanup);
  const daemon = await startDaemon({ root: repo.root, env: repo.env });
  if ("reason" in daemon) throw new Error(daemon.message);
  onTestFinished(() => daemon.stop("stop-requested").then(() => {}));
  await daemon.ready;
  return waitFor(
    () => {
      const store = openCodeStore(repo.commonDir, ON, { create: false });
      if (isCodeStoreOpenFailure(store)) return null;
      try {
        const summary = readSummary(store.meta, repo.worktreeId);
        // The test file is its own loader (D11.6): once it is judged, its run's record is in.
        if (summary?.files["test/child.test.ts"]?.state !== "judged") return null;
        return SOURCES.flatMap((path) => {
          const file = summary.files[path];
          if (file === undefined) return [`${path} not listed`];
          if (file.state !== "judged")
            return [`${path} ${file.state} ${"cause" in file ? file.cause : ""}`];
          return store.states
            .list(repo.worktreeId, { paths: [path] })
            .filter((s) => s.measure !== "complexity")
            .map((s) => `${s.check.qualifiedName} ${s.measure} ${s.outcome} ${s.value ?? "-"}`);
        });
      } finally {
        store.close();
      }
    },
    120_000,
    "test/child.test.ts judged",
  );
}

describe("a function only a child process runs, in the daemon (020 D12.6)", SLOW, () => {
  it("reads covered with coverage.children: CC 2 at 100%", async () => {
    expect(await judged(true)).toEqual([
      "both crap pass 2",
      "both uncovered pass -",
      "childOnly crap pass 2",
      "childOnly uncovered pass -",
    ]);
  });

  it("reads untested without it: CC 2 at 0%, CRAP 2² + 2", async () => {
    expect(await judged(false)).toEqual([
      "both crap pass 6",
      "both uncovered fail -",
      "childOnly crap pass 6",
      "childOnly uncovered fail -",
    ]);
  });

  it("has no loader of a file only the child loads with observe.runtimeInputs off", async () => {
    expect(await judged(true, false)).toEqual([
      "both crap pass 2",
      "both uncovered pass -",
      "src/child-only.mjs unknown no-loader",
    ]);
  });
});
