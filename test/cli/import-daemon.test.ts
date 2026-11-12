import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { importCommand } from "../../src/cli/import.js";
import type { CliIo } from "../../src/cli/main.js";
import { DaemonWrites } from "../../src/core/daemon/busy-writes.js";
import { createHandlers } from "../../src/core/daemon/handlers.js";
import { importInDaemon } from "../../src/core/daemon/import-request.js";
import { createDaemonServer } from "../../src/core/daemon/server.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { BusyWaits } from "../../src/core/store/busy.js";
import { listImports } from "../../src/core/store/imports.js";
import { openStore } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import { encodeBundle, type ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import type { AbsolutePath, EpochMs } from "../../src/core/types/common.js";
import type { ImportOutcome, ImportRequest } from "../../src/core/types/daemon-writes.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import { countWrites } from "../harness/daemon-writes-helpers.js";
import { type SquealRepo, squealRepo } from "../harness/helpers.js";

/*
 * Spec 021 D15 (row 021-20): while a daemon serves the worktree, `squeal
 * import` asks it to import the file, and it imports in its retried path,
 * so the command makes no write transaction of its own; a daemon that takes
 * no imports leaves the import to the command. The exit codes the CI action
 * reads stay as they were: 0 imported or dry run, 1 refused, unreadable or
 * busy past the bound, 2 a usage error.
 */

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const FILES = 3;

function bundle(keyFormat = KEY_FORMAT_VERSION): ResultsBundle {
  const paths = Array.from({ length: FILES }, (_, i) => `t/f${i}.test.ts`);
  return {
    format: "squeal-results/1",
    header: {
      squealVersion: "0.0.0-test",
      keyFormat,
      commit: "c".repeat(40),
      dirty: false,
      createdAt: 1,
      source: { kind: "local" },
    },
    environments: [],
    testFiles: paths.map((path) => ({
      project: "",
      path,
      key: `key-${path}` as CheckKey,
      closure: null,
      observed: {},
    })),
    observedStartup: [],
    results: paths.map((path) => ({
      project: "",
      testPath: path,
      kind: "file" as const,
      fullName: null,
      location: null,
      key: `key-${path}` as CheckKey,
      outcome: "pass" as const,
      durationMs: 1,
    })),
  };
}

/** `content` written to a scratch file; its path. */
function exportFile(content: ResultsBundle | string): string {
  const dir = mkdtempSync(join(tmpdir(), "sq-imp-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "results.json.gz");
  writeFileSync(file, typeof content === "string" ? content : encodeBundle(content));
  return file;
}

interface Served {
  /** The daemon's store connection: its writes are the daemon's. */
  readonly store: Store;
  /** The import requests the daemon took. */
  readonly imports: ImportRequest[];
}

/**
 * The worktree's daemon socket, served in this process by the daemon's own
 * handlers; its imports run as the daemon's main thread runs them
 * (`importInDaemon`), on its own store connection, unless `answer` stands
 * in. `takesImports` false: a daemon before this request.
 */
async function serve(
  r: SquealRepo,
  options: {
    readonly takesImports?: boolean;
    readonly answer?: (request: ImportRequest) => Promise<ImportOutcome>;
  } = {},
): Promise<Served> {
  const dir = mkdtempSync(join(tmpdir(), "sq-d-"));
  const socketPath = join(dir, "d.sock") as AbsolutePath;
  const store = openStore(r.repo.commonDir as AbsolutePath);
  if ("reason" in store) throw new Error(`no store: ${store.reason}`);
  const imports: ImportRequest[] = [];
  const writes = new DaemonWrites(new BusyWaits({ now: Date.now, note: () => {} }));
  const requestImport = async (request: ImportRequest) => {
    imports.push(request);
    if (options.answer !== undefined) return options.answer(request);
    return importInDaemon(
      {
        root: r.root as AbsolutePath,
        worktreeId: r.worktreeId,
        store,
        writes,
        now: Date.now,
        stopping: () => false,
      },
      request,
    );
  };
  const server = await createDaemonServer(
    socketPath,
    createHandlers({
      worktreeId: r.worktreeId,
      root: r.root as AbsolutePath,
      squealVersion: "0.0.0-test",
      startedAt: 1 as EpochMs,
      token: "t",
      phase: () => "ready",
      requestFullSuite: () => Promise.reject(new Error("not in this test")),
      onActivity: () => {},
      onStop: () => {},
      onStepDown: () => {},
      storeSchema: store.schemaVersion,
      ...(options.takesImports === false ? {} : { requestImport }),
    }),
  );
  r.store.worktrees.setDaemon(r.worktreeId, {
    socketPath,
    startedAt: 1 as EpochMs,
    heartbeatAt: Date.now() as EpochMs,
    heartbeatIntervalMs: 3_600_000,
    squealVersion: "0.0.0-test",
  });
  cleanups.push(async () => {
    await server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, imports };
}

async function run(r: SquealRepo, args: string[], busyBoundMs?: number) {
  const out = { stdout: "", stderr: "" };
  const cli: CliIo = {
    stdout: (text) => {
      out.stdout += text;
    },
    stderr: (text) => {
      out.stderr += text;
    },
    cwd: r.root,
    env: {},
  };
  const code = await importCommand(args, cli, busyBoundMs === undefined ? {} : { busyBoundMs });
  return { code, ...out };
}

function repo(): SquealRepo {
  const r = squealRepo();
  r.policy({});
  return r;
}

/** Holds the store's write lock from another connection of this thread until the returned release. */
function hold(r: SquealRepo): () => void {
  const db = new DatabaseSync(storePaths(r.repo.commonDir).database);
  db.exec("BEGIN IMMEDIATE");
  return () => {
    db.exec("COMMIT");
    db.close();
  };
}

describe("squeal import while a daemon serves (021 D15, row 021-20)", () => {
  it("is imported by the daemon, with no write transaction of the command's own", async () => {
    const r = repo();
    const daemon = await serve(r);
    const file = exportFile(bundle());
    const count = countWrites(daemon.store);
    const out = await run(r, [file]);
    const counted = count.stop();
    expect(out).toMatchObject({ code: 0, stderr: "" });
    expect(out.stdout).toMatch(/^Imported 3 results of 3 test files from /);
    expect(daemon.imports).toMatchObject([{ type: "import", file, dryRun: false }]);
    expect(counted.transactions).toBe(0);
    expect(counted.madeWritable).toBe(0);
    expect(listImports(r.store)).toHaveLength(1);
  });

  it("dry-runs through the daemon: the same counts, nothing written", async () => {
    const r = repo();
    const daemon = await serve(r);
    const file = exportFile(bundle());
    const count = countWrites(daemon.store);
    const out = await run(r, [file, "--dry-run"]);
    expect(count.stop().transactions).toBe(0);
    expect(out.code).toBe(0);
    expect(out.stdout).toMatch(/^Dry run, nothing written: would import 3 results of 3 test files/);
    expect(daemon.imports).toMatchObject([{ dryRun: true }]);
    expect(listImports(r.store)).toEqual([]);
  });

  it("waits out a lock another process holds under the bound, in the daemon's retried path", async () => {
    const r = repo();
    const daemon = await serve(r);
    const file = exportFile(bundle());
    const release = hold(r);
    const freed = setTimeout(release, 1_500);
    const started = Date.now();
    const out = await run(r, [file]);
    clearTimeout(freed);
    expect(out).toMatchObject({ code: 0, stderr: "" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_400);
    expect(daemon.imports).toHaveLength(1);
    expect(listImports(r.store)).toHaveLength(1);
  });

  it("is made by the command when the daemon takes no imports", async () => {
    const r = repo();
    await serve(r, { takesImports: false });
    const out = await run(r, [exportFile(bundle())]);
    expect(out).toMatchObject({ code: 0, stderr: "" });
    expect(listImports(r.store)).toHaveLength(1);
  });

  it("says what the daemon's import ended with, with exit 1", async () => {
    const r = repo();
    let outcome: ImportOutcome = { busyMs: 10_012 };
    await serve(r, { answer: async () => outcome });
    const file = exportFile(bundle());
    expect(await run(r, [file])).toMatchObject({
      code: 1,
      stderr:
        "squeal import: store busy, waited 10012 ms: another process holds the store's lock; run the command again once it is released\n",
    });
    outcome = { failed: "the daemon stopped during the import; run the command again" };
    expect(await run(r, [file])).toMatchObject({
      code: 1,
      stderr: "squeal import: the daemon stopped during the import; run the command again\n",
    });
  });
});

describe("squeal import's exit codes (018 D3; the CI action reads them)", () => {
  it("is 0 imported and on a dry run, with no daemon", async () => {
    const r = repo();
    const file = exportFile(bundle());
    expect((await run(r, [file, "--dry-run"])).code).toBe(0);
    expect(listImports(r.store)).toEqual([]);
    expect((await run(r, [file])).code).toBe(0);
    expect(listImports(r.store)).toHaveLength(1);
  });

  it("is 1 for a refused, unreadable or undecodable file, the daemon not asked", async () => {
    const r = repo();
    const daemon = await serve(r);
    const refused = await run(r, [exportFile(bundle(KEY_FORMAT_VERSION + 1))]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(
      `the export's key format is ${KEY_FORMAT_VERSION + 1}; this Squeal's is ${KEY_FORMAT_VERSION}`,
    );
    expect((await run(r, [join(tmpdir(), "sq-none", "missing.json.gz")])).code).toBe(1);
    expect((await run(r, [exportFile("not an export")])).code).toBe(1);
    expect(daemon.imports).toEqual([]);
  });

  it("is 1 with the busy text when no daemon serves and the lock outlasts the bound", async () => {
    const r = repo();
    const release = hold(r);
    try {
      const out = await run(r, [exportFile(bundle())], 300);
      expect(out.code).toBe(1);
      expect(out.stderr).toMatch(
        /^squeal import: store busy, waited \d+ ms: another process holds the store's lock; run the command again once it is released\n$/,
      );
    } finally {
      release();
    }
    expect(listImports(r.store)).toEqual([]);
  });

  it.each([[[]], [["a", "b"]], [["--force", "a"]]])("is 2 for the usage error %j", async (args) => {
    const out = await run(repo(), args);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("usage: squeal import <file> [--dry-run]");
  });
});
