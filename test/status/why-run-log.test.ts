import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatWhy, readWhy, WHY_LOG_LINE_LIMIT } from "../../src/core/status/index.js";
import { result } from "../store/helpers.js";
import { fakeRepo, seedStore, state } from "./helpers.js";
import { at, LOGIN, reportOf, seedLogin } from "./why-seed.js";

const NAME = "src/auth.test.ts > auth > login";

/** Task 001-173: `squeal why` names the run log holding a check's console output. */
describe("squeal why: the run log", () => {
  function seeded() {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const b = seedLogin(repo, store);
    const runDir = (id: string) => join(repo.commonDir, "squeal", "runs", id);
    const writeLog = (id: string, lines: readonly string[]) => {
      mkdirSync(runDir(id), { recursive: true });
      writeFileSync(join(runDir(id), "vitest.log"), `${lines.join("\n")}\n`);
    };
    return { repo, store, b, runDir, writeLog };
  }

  it("names the producing worktree's log for an inherited result", () => {
    const { repo, b, runDir, writeLog } = seeded();
    writeLog("run-a1", ["squeal vitest run run-a1"]);
    writeLog("run-b1", ["squeal vitest run run-b1"]);

    const why = reportOf(readWhy(b.root, NAME));

    expect(why.runLog).toEqual({
      runId: "run-a1",
      worktreeId: repo.mainId,
      path: join(runDir("run-a1"), "vitest.log"),
      state: "present",
      console: null,
    });
    const text = formatWhy(why);
    expect(text).toContain(`Run log: ${join(runDir("run-a1"), "vitest.log")}\n`);
    expect(text).toContain(`Run run-a1 in ${repo.main} (inherited) produced the result shown.`);
    expect(text).toContain("The log covers that whole run, every test file in it");
    expect(text).toContain("--include-logs prints the console lines of src/auth.test.ts");
  });

  it("names this worktree's own log for an own result", () => {
    const { store, b, runDir, writeLog } = seeded();
    writeLog("run-b1", ["squeal vitest run run-b1"]);
    store.knownStates.upsertMany([
      state(b.id, LOGIN, { outcome: "fail", observedAt: 1, commit: "abc123" }),
    ]);

    const why = reportOf(readWhy(b.root, NAME));

    expect(why.runLog).toMatchObject({
      runId: "run-b1",
      worktreeId: b.id,
      path: join(runDir("run-b1"), "vitest.log"),
      state: "present",
    });
    expect(formatWhy(why)).toContain(`Run run-b1 in ${b.root} (this worktree) produced`);
  });

  it("with --include-logs prints only the check's test file's console lines", () => {
    const { b, writeLog } = seeded();
    writeLog("run-a1", [
      "squeal vitest run run-a1",
      "[stdout] src/auth.test.ts: logging in",
      "[stdout] src/other.test.ts: not this file",
      "[stderr] src/auth.test.ts: a warning",
      "[stdout] [web] src/auth.test.ts: another project",
      "[stdout] untagged",
      "PASS src/auth.test.ts > auth > login (3 ms)",
    ]);

    const why = reportOf(readWhy(b.root, NAME, { includeLogs: true }));

    expect(why.runLog?.console).toEqual({
      lines: ["[stdout] src/auth.test.ts: logging in", "[stderr] src/auth.test.ts: a warning"],
      total: 2,
      limit: WHY_LOG_LINE_LIMIT,
    });
    expect(formatWhy(why)).toContain(
      [
        "Console of src/auth.test.ts in this log (2 lines):",
        "  [stdout] src/auth.test.ts: logging in",
        "  [stderr] src/auth.test.ts: a warning",
        "",
      ].join("\n"),
    );
  });

  it("caps the console lines and says so", () => {
    const { b, writeLog } = seeded();
    const total = WHY_LOG_LINE_LIMIT + 5;
    writeLog(
      "run-a1",
      Array.from({ length: total }, (_, i) => `[stdout] src/auth.test.ts: line ${i}`),
    );

    const why = reportOf(readWhy(b.root, NAME, { includeLogs: true }));

    expect(why.runLog?.console?.lines).toHaveLength(WHY_LOG_LINE_LIMIT);
    expect(why.runLog?.console?.total).toBe(total);
    expect(formatWhy(why)).toContain(
      `Console of src/auth.test.ts in this log (first ${WHY_LOG_LINE_LIMIT} of ${total} lines):`,
    );
  });

  it("says when the log was pruned, with or without its run record", () => {
    const { store, b, runDir } = seeded();

    const kept = reportOf(readWhy(b.root, NAME, { includeLogs: true }));
    expect(kept.runLog).toMatchObject({ runId: "run-a1", state: "pruned", console: null });
    expect(formatWhy(kept)).toContain(
      `Run log: ${join(runDir("run-a1"), "vitest.log")} was pruned; run run-a1 in `,
    );

    const own = result(LOGIN, "k2", {
      outcome: "fail",
      worktreeId: b.id,
      recordedAt: at(12),
      runId: "run-gone",
    });
    store.results.putMany([own]);
    store.knownStates.upsertMany([
      state(b.id, LOGIN, { outcome: "fail", observedAt: 4, commit: "abc123" }),
    ]);
    const gone = reportOf(readWhy(b.root, NAME));
    expect(gone.runLog).toMatchObject({
      runId: "run-gone",
      path: join(runDir("run-gone"), "vitest.log"),
      state: "pruned",
    });
  });

  it("says when the run wrote no vitest.log, and with --include-logs that no console was captured", () => {
    const { b, runDir } = seeded();
    mkdirSync(join(runDir("run-a1"), "node-test"), { recursive: true });

    const plain = reportOf(readWhy(b.root, NAME));
    expect(plain.runLog).toMatchObject({ state: "not-vitest", console: null });
    expect(formatWhy(plain)).toContain(`Its runner's output is under ${runDir("run-a1")}\n`);
    expect(formatWhy(plain)).not.toContain("No console");

    const why = reportOf(readWhy(b.root, NAME, { includeLogs: true }));
    expect(why.runLog).toMatchObject({
      state: "not-vitest",
      console: { lines: [], total: 0, limit: WHY_LOG_LINE_LIMIT },
    });
    expect(formatWhy(why)).toContain(
      "  No console of src/auth.test.ts was captured in this run.\n",
    );
  });

  it("says when no stored result is behind the known state", () => {
    const { repo, store } = seeded();
    const c = repo.addWorktree("c");
    store.knownStates.upsertMany([state(c.id, LOGIN, { origin: { kind: "own" } })]);

    const why = reportOf(readWhy(c.root, NAME));

    expect(why.runLog).toBeNull();
    expect(formatWhy(why)).toContain(
      "Run log: unknown, no stored result is identifiably the one behind the known state",
    );
  });
});
