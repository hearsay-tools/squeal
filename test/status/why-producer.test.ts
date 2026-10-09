import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { consolePrefix, parseConsoleLine } from "../../src/core/run-log.js";
import { formatWhy, readWhy, WHY_RESULT_LIMIT } from "../../src/core/status/index.js";
import type { CheckId, ResultRecord, Store } from "../../src/core/types/index.js";
import { result } from "../store/helpers.js";
import { check, fakeRepo, seedStore, state } from "./helpers.js";
import { at, COMMIT, LOGIN, reportOf, seedLogin } from "./why-seed.js";

const NAME = "src/auth.test.ts > auth > login";

/** `result` with the provenance fields these cases tell apart. */
function stored(
  c: CheckId,
  key: string,
  p: { worktreeId: string; runId: string; revision: number; minute: number; commit?: string },
  outcome: ResultRecord["outcome"] = "pass",
): ResultRecord {
  const r = result(c, key, {
    outcome,
    worktreeId: p.worktreeId,
    runId: p.runId,
    recordedAt: at(12, p.minute),
  });
  return {
    ...r,
    provenance: { ...r.provenance, revision: p.revision, commit: p.commit ?? COMMIT },
  };
}

function fileKey(store: Store, worktreeId: string, path: string, key: string, project = "") {
  store.testFileKeys.upsertMany([
    { worktreeId, testFile: { project, path }, key, revision: 1, pending: null },
  ]);
}

function seeded() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const b = seedLogin(repo, store);
  const runDir = (id: string) => join(repo.commonDir, "squeal", "runs", id);
  const writeFile = (id: string, name: string, text: string) => {
    mkdirSync(dirname(join(runDir(id), name)), { recursive: true });
    writeFileSync(join(runDir(id), name), text);
  };
  const writeLog = (id: string, lines: readonly string[]) =>
    writeFile(id, "vitest.log", `${lines.join("\n")}\n`);
  return { repo, store, b, runDir, writeFile, writeLog };
}

/** Review wave-13i B4: the run named is the one that stored the result the known state shows. */
describe("squeal why: the producing run", () => {
  it("names the result at the current key, not a newer run of another key, past the listed rows", () => {
    const { repo, store, b, writeLog } = seeded();
    // K0 passed at revision 1, K1 at revision 2; reverted, K0 is current again from revision 1.
    store.results.putMany([
      stored(LOGIN, "k0", { worktreeId: b.id, runId: "run-k0", revision: 1, minute: 1 }),
      stored(LOGIN, "k1", { worktreeId: b.id, runId: "run-k1", revision: 2, minute: 2 }),
      ...Array.from({ length: WHY_RESULT_LIMIT + 5 }, (_, i) =>
        stored(LOGIN, `other-${i}`, {
          worktreeId: repo.mainId,
          runId: `run-other-${i}`,
          revision: 9,
          minute: 10 + i,
        }),
      ),
    ]);
    fileKey(store, b.id, "src/auth.test.ts", "k0");
    store.knownStates.upsertMany([state(b.id, LOGIN, { observedAt: 1, commit: COMMIT })]);
    writeLog("run-k0", [`${consolePrefix("stdout", "src/auth.test.ts")}OLD KEY OUTPUT`]);
    writeLog("run-k1", [`${consolePrefix("stdout", "src/auth.test.ts")}NEW KEY OUTPUT`]);

    const why = reportOf(readWhy(b.root, NAME, { includeLogs: true }));

    expect(why.results).toHaveLength(WHY_RESULT_LIMIT);
    expect(why.results.some((e) => e.result.provenance.runId === "run-k0")).toBe(false);
    expect(why.runLog).toMatchObject({ runId: "run-k0", state: "present" });
    const text = formatWhy(why);
    expect(text).toContain("Run run-k0 in ");
    expect(text).toContain("OLD KEY OUTPUT");
    expect(text).not.toContain("NEW KEY OUTPUT");
  });

  it("tells inherited results of several keys at one commit apart by the current key", () => {
    const { repo, store, b } = seeded();
    store.results.putMany([
      stored(LOGIN, "k1", { worktreeId: repo.mainId, runId: "run-m1", revision: 3, minute: 1 }),
      stored(LOGIN, "k2", { worktreeId: repo.mainId, runId: "run-m2", revision: 4, minute: 2 }),
    ]);
    fileKey(store, b.id, "src/auth.test.ts", "k1");

    expect(reportOf(readWhy(b.root, NAME)).runLog?.runId).toBe("run-m1");

    // Stale under a third key: both rows fit the inherited state, so neither is named.
    fileKey(store, b.id, "src/auth.test.ts", "k3");
    store.knownStates.upsertMany([
      state(b.id, LOGIN, {
        validity: "stale",
        observedAt: 2,
        commit: COMMIT,
        origin: { kind: "inherited", worktreeId: repo.mainId, commit: COMMIT },
      }),
    ]);
    const stale = reportOf(readWhy(b.root, NAME));
    expect(stale.runLog).toBeNull();
    expect(formatWhy(stale)).toContain("Run log: unknown, no stored result is identifiably");
  });

  it("names a stale own result by its revision, and none once the row was replaced", () => {
    const { store, b } = seeded();
    store.results.putMany([
      stored(LOGIN, "k0", { worktreeId: b.id, runId: "run-k0", revision: 1, minute: 1 }),
      stored(LOGIN, "k1", { worktreeId: b.id, runId: "run-k1", revision: 2, minute: 2 }),
    ]);
    fileKey(store, b.id, "src/auth.test.ts", "k5");
    store.knownStates.upsertMany([
      state(b.id, LOGIN, { validity: "stale", observedAt: 1, commit: COMMIT }),
    ]);
    expect(reportOf(readWhy(b.root, NAME)).runLog?.runId).toBe("run-k0");

    // A later run stored K0 again: the row no longer holds the result the current state names.
    fileKey(store, b.id, "src/auth.test.ts", "k0");
    store.results.putMany([
      stored(LOGIN, "k0", { worktreeId: b.id, runId: "run-k0b", revision: 3, minute: 3 }),
    ]);
    store.knownStates.upsertMany([state(b.id, LOGIN, { observedAt: 1, commit: COMMIT })]);
    expect(reportOf(readWhy(b.root, NAME)).runLog).toBeNull();
  });
});

/** Review wave-13i S2: a file's console lines are matched by their exact label. */
describe("squeal why --include-logs: file labels", () => {
  const A = check("test/a.test.ts", "x");
  const AB = check("test/a.test.ts: b.test.ts", "y");

  it("keeps a label that another label starts with apart, and an untagged line that starts with it", () => {
    const { store, b, writeLog } = seeded();
    store.results.putMany([
      stored(A, "ka", { worktreeId: b.id, runId: "run-ab", revision: 1, minute: 1 }),
      stored(AB, "kb", { worktreeId: b.id, runId: "run-ab", revision: 1, minute: 1 }),
    ]);
    store.knownStates.upsertMany([
      state(b.id, A, { commit: COMMIT }),
      state(b.id, AB, { commit: COMMIT }),
    ]);
    writeLog("run-ab", [
      `${consolePrefix("stdout", "test/a.test.ts")}A OUTPUT`,
      `${consolePrefix("stdout", "test/a.test.ts: b.test.ts")}B OUTPUT`,
      `${consolePrefix("stdout", null)}test/a.test.ts: UNTAGGED`,
    ]);

    const a = reportOf(readWhy(b.root, "test/a.test.ts > x", { includeLogs: true }));
    expect(a.runLog?.console?.lines).toEqual(["[stdout] test/a.test.ts: A OUTPUT"]);
    const ab = reportOf(readWhy(b.root, "test/a.test.ts: b.test.ts > y", { includeLogs: true }));
    expect(ab.runLog?.console?.lines).toEqual(['[stdout] "test/a.test.ts: b.test.ts": B OUTPUT']);
  });

  it("reads back every label it writes", () => {
    for (const label of ["test/a.test.ts", "[web] a.ts", 'a"b.ts', "a:", "a: b", "a\nb", "a\\b"]) {
      const line = `${consolePrefix("stderr", label)}text: more`;
      expect(parseConsoleLine(line)).toEqual({ type: "stderr", label, text: "text: more" });
    }
    expect(parseConsoleLine(`${consolePrefix("stdout", null)}a.ts: text`)).toEqual({
      type: "stdout",
      label: null,
      text: "a.ts: text",
    });
    expect(parseConsoleLine("PASS a.ts > x")).toBeNull();
  });
});

/** Review wave-13i S3: a node:test file's console is its own stdout and stderr logs. */
describe("squeal why --include-logs: node:test", () => {
  const UNIT = {
    kind: "test",
    project: "units",
    testPath: "test/n.test.js",
    fullName: "n",
  } as const;
  const UNIT_NAME = "[units] test/n.test.js > n";

  function nodeTestRun() {
    const s = seeded();
    s.store.results.putMany([
      stored(UNIT, "kn", { worktreeId: s.b.id, runId: "run-n", revision: 1, minute: 1 }),
    ]);
    s.store.knownStates.upsertMany([state(s.b.id, UNIT, { commit: COMMIT })]);
    return { ...s, dir: join(s.runDir("run-n"), "node-test", "units") };
  }

  it("prints the file's own stdout and stderr lines", () => {
    const { b, dir, writeFile } = nodeTestRun();
    const files = [{ testFile: "test/other.test.js" }, { testFile: "test/n.test.js" }];
    writeFile("run-n", "node-test/units/run.json", JSON.stringify({ files }));
    writeFile("run-n", "node-test/units/stdout-0.log", "OTHER FILE\n");
    writeFile("run-n", "node-test/units/stdout-1.log", "hello\nworld\n");
    writeFile("run-n", "node-test/units/stderr-1.log", "careful\n");

    const plain = reportOf(readWhy(b.root, UNIT_NAME));
    expect(plain.runLog).toMatchObject({
      state: "node-test",
      path: join(dir, "stdout-1.log"),
      stderrPath: join(dir, "stderr-1.log"),
      console: null,
    });
    expect(formatWhy(plain)).toContain(
      `stdout above, stderr ${join(dir, "stderr-1.log")}.\n  --include-logs prints the console lines of [units] test/n.test.js from them.`,
    );

    const why = reportOf(readWhy(b.root, UNIT_NAME, { includeLogs: true }));
    expect(why.runLog?.console?.lines).toEqual([
      "[stdout] [units] test/n.test.js: hello",
      "[stdout] [units] test/n.test.js: world",
      "[stderr] [units] test/n.test.js: careful",
    ]);
    expect(formatWhy(why)).toContain("Console of [units] test/n.test.js in these logs (3 lines):");
    expect(formatWhy(why)).not.toContain("OTHER FILE");
  });

  it("says plainly when the run left no log of the file", () => {
    const { b, writeFile } = nodeTestRun();
    writeFile("run-n", "node-test/units/stdout-0.log", "no run.json was written\n");

    const why = reportOf(readWhy(b.root, UNIT_NAME, { includeLogs: true }));
    expect(why.runLog).toMatchObject({ state: "not-vitest" });
    expect(formatWhy(why)).toContain(
      "  No console of [units] test/n.test.js was captured in this run.",
    );
  });
});

/** Review wave-13i N1: a held check is found by a fragment of its name. */
describe("squeal why: a held check by name fragment", () => {
  it("finds another worktree's fail held under a current key, but not its older checks", () => {
    const { repo, store, b } = seeded();
    const heldCheck = check("src/auth.test.ts", "auth > held one");
    const oldCheck = check("src/auth.test.ts", "auth > history only");
    store.results.putMany([
      stored(
        heldCheck,
        "kh",
        { worktreeId: repo.mainId, runId: "r1", revision: 3, minute: 1 },
        "fail",
      ),
      stored(
        oldCheck,
        "kold",
        { worktreeId: repo.mainId, runId: "r0", revision: 2, minute: 0 },
        "fail",
      ),
    ]);
    fileKey(store, b.id, "src/auth.test.ts", "kh");

    const why = reportOf(readWhy(b.root, "held one"));
    expect(why.check).toEqual(heldCheck);
    expect(why.knownState).toBeNull();
    expect(why.heldFailure?.provenance.runId).toBe("r1");
    expect(why.runLog?.runId).toBe("r1");

    expect(readWhy(b.root, "history only")).toMatchObject({ found: false, candidates: [] });
  });
});
