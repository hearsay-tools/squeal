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
 * no test file loads it.
 */

const lines = (...text: string[]) => `${text.join("\n")}\n`;

const FILES = {
  "src/child-only.mjs": lines(
    "export function childOnly(x) {",
    '  return x > 1 ? "big" : "small";',
    "}",
  ),
  "bin/child.mjs": lines(
    'import { childOnly } from "../src/child-only.mjs";',
    "process.stdout.write(childOnly(Number(process.argv[2])));",
  ),
  "test/child.test.ts": lines(
    'import { execFileSync } from "node:child_process";',
    'import { fileURLToPath } from "node:url";',
    'import { expect, it } from "vitest";',
    'it("runs a child", () => {',
    '  const bin = fileURLToPath(new URL("../bin/child.mjs", import.meta.url));',
    '  expect(execFileSync(process.execPath, [bin, "3"], { encoding: "utf8" })).toBe("big");',
    "});",
  ),
};

const policy = (children: boolean, runtimeInputs: boolean) =>
  `${JSON.stringify({
    complexity: { enabled: true },
    coverage: { enabled: true, children },
    observe: { runtimeInputs },
    baseline: { onStart: "lookup-then-run-missing" },
  })}\n`;

/**
 * `src/child-only.mjs`'s coverage states once its test file's run is
 * judged, or its file state and cause when it is not judged.
 */
async function childOnly(children: boolean, runtimeInputs = true): Promise<readonly string[]> {
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
        const file = summary?.files["src/child-only.mjs"];
        // The test file is its own loader (D11.6): once it is judged, its run's record is in.
        if (file === undefined || summary?.files["test/child.test.ts"]?.state !== "judged") {
          return null;
        }
        if (file.state !== "judged") return [`${file.state} ${"cause" in file ? file.cause : ""}`];
        return store.states
          .list(repo.worktreeId, { paths: ["src/child-only.mjs"] })
          .filter((s) => s.measure !== "complexity")
          .map((s) => `${s.check.qualifiedName} ${s.measure} ${s.outcome} ${s.value ?? "-"}`);
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
    expect(await childOnly(true)).toEqual(["childOnly crap pass 2", "childOnly uncovered pass -"]);
  });

  it("reads untested without it: CC 2 at 0%, CRAP 2² + 2", async () => {
    expect(await childOnly(false)).toEqual(["childOnly crap pass 6", "childOnly uncovered fail -"]);
  });

  it("has no loader with observe.runtimeInputs off", async () => {
    expect(await childOnly(true, false)).toEqual(["unknown no-loader"]);
  });
});
