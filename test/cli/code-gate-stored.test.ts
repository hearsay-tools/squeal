import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codeGateCommand } from "../../src/cli/code-gate.js";
import { storedFiles } from "../../src/cli/code-gate-stored.js";
import { COVERAGE_RECORD_VERSION } from "../../src/core/code/coverage/record.js";
import type { GateAdapters } from "../../src/core/code/gate/collect.js";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { codeStorePath } from "../../src/core/code/store/open.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { ADAPTERS } from "../code/gate/collect-fixture.js";
import { createFixtureRepo, type FixtureRepo, waitFor, withStore } from "../daemon/helpers.js";
import { git } from "../hash/git-repo.js";

/*
 * Spec 020 D11.7 (row 020-07c): `squeal code --base` keys each selected
 * test file as a daemon in the worktree keys it, and takes the files with
 * results and a coverage record at that key from the stores, read-only. A
 * real daemon runs the scheduler fixture first; the gate then runs only
 * what the stores lack, and leaves them byte for byte as they were.
 */

const SLOW = { timeout: 240_000 } as const;

const POLICY = `${JSON.stringify({
  complexity: { enabled: true },
  coverage: { enabled: true },
  baseline: { onStart: "lookup-then-run-missing" },
})}\n`;

/**
 * The feature branch: `add` and `upper` edited, a test of `upper` that
 * fails, and a test that reads a file outside its import graph, which its
 * daemon's key holds once observed.
 */
const FEATURE: Readonly<Record<string, string>> = {
  "data/input.txt": "hello\n",
  "test/reads.test.ts": `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\n\nit("reads its input", () => {\n  expect(readFileSync(new URL("../data/input.txt", import.meta.url), "utf8")).toBe("hello\\n");\n});\n`,
  "src/math.ts": "export const add = (a: number, b: number) => b + a;\n",
  "src/strings.ts": "export const upper = (s: string) => String(s).toUpperCase();\n",
  "test/fail.test.ts": `import { expect, it } from "vitest";\nimport { upper } from "../src/strings.ts";\n\nit("fails", () => {\n  expect(upper("a")).toBe("B");\n});\n`,
};

const TEST_FILES = 7;

const ref = (path: string): TestFileRef => ({ project: "", path });

/** Each test file's key as the daemon stored it, once every file has results there. */
function daemonKeys(repo: FixtureRepo): Map<string, CheckKey> | null {
  return withStore(repo, (store) => {
    const rows = store.testFileKeys.list(repo.worktreeId);
    const done = rows.filter((r) => r.key !== null && store.results.byKey(r.key, 0).length > 0);
    if (rows.length !== TEST_FILES || done.length !== TEST_FILES) return null;
    return new Map(done.map((r) => [r.testFile.path, r.key as CheckKey]));
  });
}

/** Whether the code store holds a record at `key`, read-only. */
function hasRecord(repo: FixtureRepo, key: CheckKey): boolean {
  const db = new DatabaseSync(codeStorePath(repo.commonDir), { readOnly: true });
  try {
    const sql = "SELECT 1 FROM coverage WHERE result_key = ? AND provider_version = ?";
    return db.prepare(sql).get(key, COVERAGE_RECORD_VERSION) !== undefined;
  } finally {
    db.close();
  }
}

/** Each store file's bytes, as a hash, and its mtime. */
function snapshot(repo: FixtureRepo): string[] {
  return [storePaths(repo.commonDir).database, codeStorePath(repo.commonDir)].map((path) => {
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    return `${path} ${hash} ${statSync(path).mtimeMs}`;
  });
}

/** The CLI's adapters, each Vitest run's files appended to `ran`. */
function watched(ran: string[]): GateAdapters {
  const wrap = (adapter: RunnerAdapter): RunnerAdapter =>
    new Proxy(adapter, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (key !== "run") return value.bind(target);
        return (files: readonly TestFileRef[], ...rest: unknown[]) => {
          ran.push(...files.map((f) => f.path));
          return (value as (...args: unknown[]) => unknown).call(target, files, ...rest);
        };
      },
    });
  return { ...ADAPTERS, vitest: async (options) => wrap(await createVitestAdapter(options)) };
}

interface Gate {
  readonly code: number;
  readonly report: GateReport;
  readonly stderr: string;
  readonly ran: readonly string[];
  readonly leftInTmp: readonly string[];
}

async function gate(repo: FixtureRepo, args: readonly string[]): Promise<Gate> {
  const ran: string[] = [];
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: (text: string) => {
      stdout += text;
    },
    stderr: (text: string) => {
      stderr += text;
    },
    cwd: repo.root,
    env: repo.env,
  };
  // D3.5: a `TMPDIR` of the command's own, which it must leave empty.
  const temp = mkdtempSync(join(tmpdir(), "squeal-gate-stored-"));
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = temp;
  let code: number;
  try {
    code = await codeGateCommand(["--base", "main", ...args, "--json"], io, watched(ran));
  } finally {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
  }
  const leftInTmp = readdirSync(temp);
  rmSync(temp, { recursive: true, force: true });
  return { code, report: JSON.parse(stdout) as GateReport, stderr, ran, leftInTmp };
}

describe("squeal code --base reads the stores (spec 020 D11.7)", () => {
  let repo: FixtureRepo;
  let keys: Map<string, CheckKey>;

  beforeAll(async () => {
    repo = createFixtureRepo({ files: { "squeal.config.json": POLICY } });
    git(repo.root, ["checkout", "-q", "-b", "feature"]);
    for (const [path, text] of Object.entries(FEATURE)) {
      mkdirSync(dirname(join(repo.root, path)), { recursive: true });
      writeFileSync(join(repo.root, path), text);
    }
    git(repo.root, ["add", "-A"]);
    git(repo.root, ["commit", "-qm", "feature"]);
    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    try {
      await daemon.ready;
      keys = await waitFor(
        () => {
          const found = daemonKeys(repo);
          const paths = [
            "test/math.test.ts",
            "test/reads.test.ts",
            "test/upper.test.ts",
            "test/fail.test.ts",
            "test/strings.test.ts",
          ];
          return found !== null &&
            paths.every((path) => hasRecord(repo, found.get(path) as CheckKey))
            ? found
            : null;
        },
        180_000,
        "results at every key and records for the passing files",
      );
    } finally {
      await daemon.stop("stop-requested");
    }
  }, SLOW.timeout);

  afterAll(() => repo?.cleanup());

  it("keys every test file as the daemon keyed it", SLOW, async () => {
    const stored = storedFiles(repo.root, repo.env, () => {});
    expect(stored).not.toBeNull();
    try {
      const refs = [...keys.keys()].sort().map(ref);
      const gateKeys = await stored?.keys(refs);
      expect(refs.map((r) => [r.path, gateKeys?.get(r)])).toEqual(
        refs.map((r) => [r.path, keys.get(r.path)]),
      );
    } finally {
      await stored?.close();
    }
  });

  it(
    "does not run a file with results and a record at its key, and writes no store",
    SLOW,
    async () => {
      const before = snapshot(repo);

      const ran = await gate(repo, ["src/math.ts"]);

      expect(ran.ran).toEqual([]);
      expect(ran.code).toBe(0);
      expect(ran.stderr).toBe(
        "squeal code: Vitest: 1 test file to run (tests 1)\nsqueal code: 1 of 1 selected test files read from the stores\n",
      );
      const { verdict, functions, runs } = ran.report;
      expect(verdict).toBe("pass");
      expect(runs.map((r) => [r.runner, r.completed, r.from])).toEqual([
        ["vitest", ["test/math.test.ts"], { "test/math.test.ts": "store" }],
      ]);
      expect(functions.map((f) => [f.qualifiedName, f.state, f.coverage?.share])).toEqual([
        ["add", "pass", 1],
      ]);
      expect(functions[0]?.loaders.measured).toEqual(["test/math.test.ts"]);
      expect(ran.leftInTmp).toEqual([]);
      expect(snapshot(repo)).toEqual(before);
    },
  );

  it("reads a stored failure as a failure: the verdict is incomplete", SLOW, async () => {
    const before = snapshot(repo);
    expect(hasRecord(repo, keys.get("test/fail.test.ts") as CheckKey)).toBe(true);

    const ran = await gate(repo, ["src/strings.ts"]);

    expect(ran.ran).toEqual([]);
    expect(ran.code).toBe(3);
    const { verdict, runs } = ran.report;
    expect(verdict).toBe("incomplete");
    expect(runs[0]?.from).toEqual({
      "test/fail.test.ts": "store",
      "test/strings.test.ts": "store",
      "test/upper.test.ts": "store",
    });
    expect(runs[0]?.failed).toEqual([{ path: "test/fail.test.ts", tests: ["fails"] }]);
    expect(snapshot(repo)).toEqual(before);
  });

  it("runs a file with results and no record at its key", SLOW, async () => {
    const key = keys.get("test/math.test.ts") as CheckKey;
    const db = new DatabaseSync(codeStorePath(repo.commonDir));
    db.prepare("DELETE FROM coverage WHERE result_key = ?").run(key);
    db.close();
    expect(withStore(repo, (store) => store.results.byKey(key, 0).length)).toBeGreaterThan(0);
    const before = snapshot(repo);

    const ran = await gate(repo, ["src/math.ts"]);

    expect(ran.ran).toEqual(["test/math.test.ts"]);
    expect(ran.code).toBe(0);
    expect(ran.stderr).toBe("squeal code: Vitest: 1 test file to run (tests 1)\n");
    expect(ran.report.runs.map((r) => [r.completed, r.from])).toEqual([
      [["test/math.test.ts"], undefined],
    ]);
    expect(snapshot(repo)).toEqual(before);
  });
});

/*
 * Spec 020 D12.5 (row 020-10b, request 35b31f66): the key holds
 * `coverage.children`, and the gate keys with the base's value. A branch
 * that turns children on in its own config has its daemon's records,
 * collected with children, at keys the gate does not read.
 */
describe("squeal code --base keys the stores with the base's coverage.children", () => {
  let repo: FixtureRepo;
  let key: CheckKey;

  beforeAll(async () => {
    repo = createFixtureRepo({ files: { "squeal.config.json": POLICY } });
    git(repo.root, ["checkout", "-q", "-b", "feature"]);
    const policy = JSON.parse(POLICY) as { coverage: Record<string, unknown> };
    policy.coverage.children = true;
    writeFileSync(join(repo.root, "squeal.config.json"), `${JSON.stringify(policy)}\n`);
    writeFileSync(join(repo.root, "src/math.ts"), FEATURE["src/math.ts"] as string);
    git(repo.root, ["commit", "-qam", "feature: children on"]);
    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    try {
      await daemon.ready;
      key = await waitFor(
        () =>
          withStore(repo, (store) => {
            const row = store.testFileKeys
              .list(repo.worktreeId)
              .find((r) => r.testFile.path === "test/math.test.ts");
            if (row?.key == null || store.results.byKey(row.key, 0).length === 0) return null;
            return hasRecord(repo, row.key) ? row.key : null;
          }),
        180_000,
        "a result and a record at test/math.test.ts's key",
      );
    } finally {
      await daemon.stop("stop-requested");
    }
  }, SLOW.timeout);

  afterAll(() => repo?.cleanup());

  it("finds the daemon's key with children on, and another with them off", SLOW, async () => {
    const math = ref("test/math.test.ts");
    const keyed = async (children: boolean) => {
      const stored = storedFiles(repo.root, repo.env, () => {}, children);
      try {
        return (await stored?.keys([math]))?.get(math);
      } finally {
        await stored?.close();
      }
    };
    expect(await keyed(true)).toBe(key);
    expect(await keyed(false)).not.toBe(key);
  });

  it(
    "runs the file the daemon stored with children, where the base keeps them off",
    SLOW,
    async () => {
      const before = snapshot(repo);

      const ran = await gate(repo, ["src/math.ts"]);

      expect(ran.ran).toEqual(["test/math.test.ts"]);
      expect(ran.report.base.policy).not.toHaveProperty("coverageChildren");
      expect(ran.report.runs.map((r) => [r.completed, r.from])).toEqual([
        [["test/math.test.ts"], undefined],
      ]);
      expect(ran.code).toBe(0);
      expect(snapshot(repo)).toEqual(before);
    },
  );
});
