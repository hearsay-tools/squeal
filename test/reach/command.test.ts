import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { reachCommand } from "../../src/cli/reach.js";
import { COVERAGE_PROVIDER_VERSION, encodeRecord } from "../../src/core/code/coverage/record.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../../src/core/code/store/open.js";
import type { ReachReport } from "../../src/core/reach/report-types.js";
import type { ImportGraph } from "../../src/core/reach/types.js";
import { changeMarker } from "../../src/core/store/store.js";
import type { Store } from "../../src/core/types/store.js";
import { ON as CODE_ON } from "../code/helpers.js";
import { type FakeRepo, fakeRepo, seedStore } from "../status/helpers.js";
import { fakeGraph } from "./fixture.js";

/*
 * Row 015-109 (spec 015 D11): `squeal reach` from a real store: exit codes
 * 0, 1 and 2, `--json`, `--limit`, named paths, the proposals, and no write.
 */

const A = "test/a.test.ts";
const B = "test/b.test.ts";
const SRC = ["src/one.ts", "src/two.ts"];

const open: Store[] = [];
afterEach(() => {
  for (const store of open.splice(0)) store.close();
});

function run(cwd: string, args: string[], graph: ImportGraph | null = fakeGraph({})) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    cwd,
    env: {},
  };
  const options = graph === null ? {} : { graph: () => graph };
  return reachCommand(args, io, options).then((code) => ({ code, stdout, stderr }));
}

/** Listed test files A over `src/one.ts` and B over both sources, with recorded seconds only when `ran`. */
function seeded(policy: object, { ran = true } = {}): { repo: FakeRepo; store: Store } {
  const repo = fakeRepo();
  writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify(policy));
  const store = seedStore(repo);
  open.push(store);
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  store.testFileKeys.upsertMany(
    [A, B].map((path) => ({
      worktreeId: repo.mainId,
      testFile: { project: "", path },
      key: `key-${path}`,
      revision: 1,
      pending: null,
    })),
  );
  for (const path of [A, B]) {
    store.testFiles.put({
      testFile: { project: "", path },
      closure: {
        testFile: { project: "", path },
        paths: path === A ? [A, "src/one.ts"] : [B, ...SRC],
        complete: true,
        method: "static imports plus declared inputs",
      },
      updatedAt: 1,
      updatedBy: repo.mainId,
    });
  }
  const timed = ran ? [A, B] : [];
  store.results.putMany(
    timed.map((path, i) => ({
      check: { kind: "file", project: "", testPath: path },
      key: `key-${path}`,
      outcome: "pass",
      durationMs: (i + 1) * 1000,
      location: null,
      fingerprint: null,
      summary: null,
      errors: [],
      provenance: {
        worktreeId: repo.mainId,
        revision: 1,
        commit: null,
        dirty: true,
        runId: "run-1",
        recordedAt: 1,
      },
    })),
  );
  store.transaction(() => {
    for (const [at, trigger, paths] of [
      [1, "start", ["src/one.ts"]],
      [2, "watch", ["src/one.ts"]],
      [3, "watch", ["src/one.ts", "src/two.ts"]],
    ] as const) {
      store.revisions.append({
        worktreeId: repo.mainId,
        createdAt: Date.UTC(2026, 10, at),
        head: null,
        dirty: true,
        trigger,
        changes: paths.map((path) => ({ path, oldHash: "h0", newHash: `h${at}` })),
      });
    }
  });
  return { repo, store };
}

/** A's record calls `src/one.ts`; B's loads both and calls none. */
function records(repo: FakeRepo) {
  const code = openCodeStore(repo.commonDir, CODE_ON);
  if (isCodeStoreOpenFailure(code)) throw new Error(JSON.stringify(code));
  const source = (path: string, hit: 0 | 1) => ({
    path,
    blob: `blob-${path}`,
    lines: "",
    covered: "",
    functions: [
      [1, 0, 9, 1, 1],
      [2, 2, 4, 3, hit],
    ] as const,
  });
  const put = (key: string, sources: ReturnType<typeof source>[]) =>
    code.coverage.put(
      { resultKey: key, providerVersion: COVERAGE_PROVIDER_VERSION },
      encodeRecord({ v: 1, sources, unread: [] }),
      1,
    );
  put(`key-${A}`, [source("src/one.ts", 1)]);
  put(`key-${B}`, [source("src/one.ts", 0), source("src/two.ts", 0)]);
  code.close();
}

const ON = { complexity: { enabled: true }, coverage: { enabled: true } };

describe("squeal reach", () => {
  it("exits 2 on a usage error", async () => {
    const { repo } = seeded(ON);
    for (const args of [["--nope"], ["--limit"], ["--limit", "0"], ["--limit=x"]]) {
      const r = await run(repo.main, args);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.stderr).toContain("Usage: squeal reach [<path>...] [--limit <n>] [--json]");
    }
  });

  it("exits 1 with no store", async () => {
    const repo = fakeRepo();
    const r = await run(repo.main, ["--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ available: false, reason: "no-store" });
  });

  it("proposes the warm-up while no test file has a recorded result", async () => {
    const { repo } = seeded(ON, { ran: false });
    const r = await run(repo.main, []);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      "Reach: no test file of this worktree has a recorded result, so Squeal cannot tell yet what an edit re-runs.\n" +
        "Proposal: squeal warmup runs every test file without a current result (2 test files listed). It costs about one run of the whole suite; with coverage on, each test file's coverage record costs about a tenth more CPU in each run. squeal reach starts nothing.\n",
    );
  });

  it("reads coverage records, edits and seconds, and writes nothing", async () => {
    const { repo, store } = seeded(ON);
    records(repo);
    const before = changeMarker(store);
    const r = await run(repo.main, ["--json"]);
    expect(r.code).toBe(0);
    expect(changeMarker(store)).toEqual(before);
    const report = JSON.parse(r.stdout) as ReachReport;
    expect(report).toMatchObject({
      v: 1,
      history: true,
      suite: { testFiles: 2, seconds: 3, withoutSeconds: 0, withoutClosure: 0, leftOut: 0 },
      window: { from: Date.UTC(2026, 10, 2), to: Date.UTC(2026, 10, 3), edits: 2 },
      coverage: "on",
      edges: true,
      notRecorded: 3,
      proposals: [],
    });
    expect(report.files.map((f) => [f.files, f.avoidableSeconds, f.seconds, f.edits])).toEqual([
      [["src/one.ts"], 2, 3, 2],
      [["src/two.ts"], 2, 2, 1],
    ]);
    expect(report.files[0]?.coverage).toEqual({ called: 1 / 3, "loaded only": 2 / 3 });
  });

  it("lists --limit entries per part and gives a named file in full", async () => {
    const { repo } = seeded(ON);
    records(repo);
    const limited = JSON.parse((await run(repo.main, ["--json", "--limit", "1"])).stdout);
    expect(limited).toMatchObject({ moreFiles: 1, moreTestFiles: 1 });
    expect(limited.files).toHaveLength(1);
    const named = await run(join(repo.main, "src"), ["one.ts"], null);
    expect(named.code).toBe(0);
    expect(named.stdout).toContain(
      "src/one.ts: re-runs 100% of the suite: 2 test files, 3 s; 2 edits in the window\n" +
        "  coverage: loaded only 67%, called 33%\n" +
        "  import: 2 test files, 3 s; loaded only 67%, called 33%\n" +
        "    test/b.test.ts  2 s  loaded only\n" +
        "    test/a.test.ts  1 s  called\n",
    );
  });

  it("names declared patterns of either shape, and a barrel read from its bytes", async () => {
    const { repo, store } = seeded({ ...ON, inputs: { "test/b.test.ts": ["src/two.ts"] } });
    mkdirSync(join(repo.main, "src"));
    writeFileSync(join(repo.main, "src/index.ts"), 'export * from "./one.js";\n');
    store.testFiles.put({
      testFile: { project: "", path: A },
      closure: {
        testFile: { project: "", path: A },
        paths: [A, "src/index.ts", "src/one.ts"],
        complete: true,
        method: "static imports plus declared inputs",
      },
      updatedAt: 1,
      updatedBy: repo.mainId,
    });
    const graph = fakeGraph({ [A]: ["src/index.ts"], "src/index.ts": ["src/one.ts"] });
    const named = JSON.parse((await run(repo.main, ["src", "--json"], graph)).stdout).named;
    expect(named.map((f: { path: string }) => f.path)).toEqual([
      "src/index.ts",
      "src/one.ts",
      "src/two.ts",
    ]);
    expect(named[1].routes).toContainEqual(
      expect.objectContaining({ kind: "barrel", gateway: "src/index.ts", testFiles: 1 }),
    );
    expect(named[2].suggestion.text).toBe(
      'the input "src/two.ts" in squeal.config.json gives src/two.ts to the test files "test/b.test.ts" matches: 1 test file here',
    );
    const list = seeded({ ...ON, inputs: ["src/one.ts"] });
    const kinds = JSON.parse(
      (await run(list.repo.main, ["src/one.ts", "--json"], null)).stdout,
    ).named[0].routes.map((r: { kind: string }) => r.kind);
    expect(kinds).toEqual(["declared input"]);
  });

  it("with coverage off, reads called unknown and proposes coverage", async () => {
    const { repo } = seeded({ complexity: { enabled: true }, coverage: { enabled: false } });
    const r = await run(repo.main, [], null);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      "Coverage is off, so called reads unknown: Squeal cannot tell which of these tests call the file; the path kinds are a proxy.",
    );
    expect(r.stdout).toContain("     coverage: called: unknown; avoidable 0 s\n");
    expect(r.stdout).toContain(
      'Proposal: set `"coverage": { "enabled": true }` in squeal.config.json, then run squeal warmup',
    );
  });

  it("gives the no-record share with coverage on and no records", async () => {
    const { repo } = seeded(ON);
    const r = await run(repo.main, ["--json"], null);
    expect(JSON.parse(r.stdout).proposals).toEqual([
      { kind: "records", command: "squeal run --all --force", testFiles: 2, share: 1 },
    ]);
  });
});
