import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { reachCommand } from "../../src/cli/reach.js";
import { COVERAGE_PROVIDER_VERSION, encodeRecord } from "../../src/core/code/coverage/record.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../../src/core/code/store/open.js";
import { blobHash } from "../../src/core/hash/blob.js";
import type { ReachReport } from "../../src/core/reach/report-types.js";
import { writeImportGraph } from "../../src/core/store/import-edges.js";
import { changeMarker, connectionOf } from "../../src/core/store/store.js";
import type { Store } from "../../src/core/types/store.js";
import { ON as CODE_ON } from "../code/helpers.js";
import { type FakeRepo, fakeRepo, seedStore } from "../status/helpers.js";
import { answerRecord } from "./v8-payload.js";

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

function run(cwd: string, args: string[]) {
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
  return reachCommand(args, io).then((code) => ({ code, stdout, stderr }));
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
      edges: false,
      notRecorded: 0,
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
    const named = await run(join(repo.main, "src"), ["one.ts"]);
    expect(named.code).toBe(0);
    expect(named.stdout).toContain(
      "src/one.ts: re-runs 100% of the suite: 2 test files, 3 s; 2 edits in the window\n" +
        "  coverage: loaded only 67%, called 33%\n" +
        "  import: 2 test files, 3 s; loaded only 67%, called 33%\n" +
        "    test/b.test.ts  2 s  loaded only\n" +
        "    test/a.test.ts  1 s  called\n",
    );
  });

  it("names declared patterns of either shape, and every file of a named folder", async () => {
    const { repo } = seeded({ ...ON, inputs: { "test/b.test.ts": ["src/two.ts"] } });
    const named = JSON.parse((await run(repo.main, ["src", "--json"])).stdout).named;
    expect(named.map((f: { path: string }) => f.path)).toEqual(["src/one.ts", "src/two.ts"]);
    expect(named[1].suggestion.text).toBe(
      'the input "src/two.ts" in squeal.config.json gives src/two.ts to the test files "test/b.test.ts" matches: 1 test file here',
    );
    const list = seeded({ ...ON, inputs: ["src/one.ts"] });
    const kinds = JSON.parse(
      (await run(list.repo.main, ["src/one.ts", "--json"])).stdout,
    ).named[0].routes.map((r: { kind: string }) => r.kind);
    expect(kinds).toEqual(["declared input"]);
  });

  it("reads real stored edges through the real reader: a barrel gateway and a setup path", async () => {
    const { repo, store } = seeded(ON);
    const files: Record<string, string> = {
      [A]: 'import { one } from "../src/index.js";\n',
      [B]: 'import { one } from "../src/one.js";\nimport { two } from "../src/two.js";\n',
      "src/index.ts": 'export * from "./one.js";\n',
      "src/one.ts": "export const one = 1;\n",
      "src/two.ts": "export const two = 2;\n",
      "vitest.config.ts":
        'import reporter from "./src/reporter.js";\nexport default { reporter };\n',
      "src/reporter.ts": "export default {};\n",
    };
    const edges: Record<string, string[]> = {
      [A]: ["src/index.ts"],
      [B]: ["src/one.ts", "src/two.ts"],
      "src/index.ts": ["src/one.ts"],
      "vitest.config.ts": ["src/reporter.ts"],
    };
    const hashes = new Map<string, string>();
    for (const [path, text] of Object.entries(files)) {
      const abs = join(repo.main, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text);
      const s = lstatSync(abs);
      const hash = blobHash(Buffer.from(text), "sha1");
      hashes.set(path, hash);
      store.fileHashes.upsertMany(repo.mainId, [
        { path, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, size: s.size, inode: s.ino, hash },
      ]);
    }
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
    const conn = connectionOf(store);
    conn.transaction(() =>
      writeImportGraph(conn, {
        root: repo.main,
        worktreeId: repo.mainId,
        now: 1,
        hashOf: (path) => hashes.get(path),
        imports: Object.entries(files).map(([path, text]) => ({
          path,
          sha1: createHash("sha1").update(text).digest("hex"),
          static: edges[path] ?? [],
          dynamic: [],
        })),
        environments: [
          { project: "", hash: "env-1", files: ["vitest.config.ts", "src/reporter.ts"] },
        ],
      }),
    );
    const report = JSON.parse((await run(repo.main, ["--json"])).stdout) as ReachReport;
    expect(report).toMatchObject({ edges: true, notRecorded: 0 });
    expect(report.files.find((e) => e.files.includes("src/reporter.ts"))).toMatchObject({
      testFiles: 2,
      kinds: { setup: 1 },
      gateway: {
        kind: "setup",
        gateway: "vitest.config.ts",
        chain: ["vitest.config.ts", "src/reporter.ts"],
      },
      suggestion: {
        text: "vitest.config.ts imports src/reporter.ts: name it by path, or load it only where it is used",
      },
    });
    const one = JSON.parse((await run(repo.main, ["src/one.ts", "--json"])).stdout).named[0];
    expect(one.routes).toEqual([
      expect.objectContaining({ kind: "direct", gateway: B, chain: [B, "src/one.ts"] }),
      expect.objectContaining({
        kind: "barrel",
        gateway: "src/index.ts",
        chain: [A, "src/index.ts", "src/one.ts"],
        testFiles: 1,
      }),
    ]);
  });

  it("reads a real record's called first-line function called, and its load-only control loaded only (R1 B1)", async () => {
    const { repo, store } = seeded(ON);
    for (const path of [A, B]) {
      store.testFiles.put({
        testFile: { project: "", path },
        closure: {
          testFile: { project: "", path },
          paths: [path, "src/answer.mjs"],
          complete: true,
          method: "static imports plus declared inputs",
        },
        updatedAt: 1,
        updatedBy: repo.mainId,
      });
    }
    const code = openCodeStore(repo.commonDir, CODE_ON);
    if (isCodeStoreOpenFailure(code)) throw new Error(JSON.stringify(code));
    for (const [path, call] of [
      [A, true],
      [B, false],
    ] as const) {
      code.coverage.put(
        { resultKey: `key-${path}`, providerVersion: COVERAGE_PROVIDER_VERSION },
        encodeRecord(answerRecord(call).record),
        1,
      );
    }
    code.close();
    const report = JSON.parse((await run(repo.main, ["--json"])).stdout) as ReachReport;
    expect(report.files[0]).toMatchObject({
      files: ["src/answer.mjs"],
      avoidableSeconds: 2,
      coverage: { called: 1 / 3, "loaded only": 2 / 3 },
    });
    expect(report.testFiles.find((t) => t.path === A)).toMatchObject({ called: 1 });
  });

  it("with coverage off, reads called unknown and proposes coverage", async () => {
    const { repo } = seeded({ complexity: { enabled: true }, coverage: { enabled: false } });
    const r = await run(repo.main, []);
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
    const r = await run(repo.main, ["--json"]);
    expect(JSON.parse(r.stdout).proposals).toEqual([
      { kind: "records", command: "squeal run --all --force", testFiles: 2, share: 1 },
    ]);
  });
});
