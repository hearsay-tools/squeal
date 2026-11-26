import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { writeCheckpointProgress } from "../../src/core/scheduler/checkpoint-progress.js";
import { publishNarrowAsks } from "../../src/core/scheduler/narrow-asks-row.js";
import { publishGroupActivity } from "../../src/core/slow/state.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { StatusSnapshot } from "../../src/core/types/status.js";
import { FAST, inTurn, keys, NOW, type Seeded, seed, states } from "./slow-tier-seed.js";

/*
 * Row 011-426 (gh-293; 011 C6): a pending file of a group that runs only
 * on request is counted and listed "on request", never "queued". In 0.1.645
 * the headline read `(98 queued, 47 unknown)` beside `0 queued`, and the
 * `Queued:` line named the 98 files of a `manual` group, so an agent waited
 * five more times for files that never run by themselves.
 */

let runtime: string;
beforeEach(() => {
  runtime = mkdtempSync(join(tmpdir(), "squeal-on-request-"));
  vi.stubEnv("XDG_RUNTIME_DIR", runtime);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(runtime, { recursive: true, force: true });
});

const policy = (at: "manual" | "commit") => ({
  checks: [{ name: "browser", runner: "vitest", tests: ["test/browser/**"], at }],
});
/** The issue's 98 browser files. */
const FILES = Array.from(
  { length: 98 },
  (_, i) => `test/browser/f${String(i).padStart(2, "0")}.test.ts`,
);
const id = (path: string) => testFileId({ project: "", path });

/** The 98 browser files queued, one pending test each; with `fast`, the fast file queued too. */
function held(at: "manual" | "commit" = "manual", fast = false): Seeded {
  const s = seed(policy(at), { revisions: 3 });
  keys(s.store, s.repo, {
    ...Object.fromEntries(FILES.map((path) => [path, "queued" as const])),
    ...(fast ? { [FAST]: "queued" as const } : {}),
  });
  states(
    s.store,
    s.repo,
    FILES.map(() => ({ validity: "pending" as const })),
    FILES,
  );
  inTurn(s);
  return s;
}

function read({ repo, store }: Seeded): { text: string; json: StatusSnapshot } {
  store.close();
  const json = readStatus(repo.main, { now: () => NOW });
  if (!json.available) throw new Error("status is unavailable");
  return { text: formatStatus(json, NOW), json };
}

const headline = (text: string) => text.split("\n").find((l) => l.startsWith("Known failures:"));
const queuedLine = (text: string) => text.split("\n").find((l) => l.startsWith("Queued:"));

describe("an on-request group's pending files read on request (row 011-426, gh-293)", () => {
  it("counts a manual group's 98 held files as on request, in the text and in --json", () => {
    const { text, json } = read(held());
    // The seed's two slow files and its fast file have never run: unknown.
    expect(headline(text)).toBe(
      "Known failures: 0; not current: 101 of 101 test files (98 on request, 3 unknown), 98 tests (98 on request)",
    );
    expect(text).not.toContain("98 queued");
    expect(text).toContain(
      "Affected checks: 0 passed, 0 running, 0 queued, 98 on request (98 tests)",
    );
    expect(json.testFilesByPhase).toEqual({ running: 0, queued: 0, onRequest: 98 });
    expect(json.testsByPhase).toEqual({ running: 0, queued: 0, onRequest: 98 });
    expect(json.pendingTestFiles?.queued).toEqual({ files: [], omitted: 0 });
    expect(json.pendingTestFiles?.onRequest?.files.map((f) => f.path)).toEqual(FILES);
    // The group's own line still names the command that runs them.
    expect(text).toContain("98 pending, waiting for `squeal run browser`");
  });

  it("leaves held files off the Queued: line, which keeps the files that run by themselves", () => {
    const { text, json } = read(held("manual", true));
    expect(headline(text)).toContain("(1 queued, 98 on request, 2 unknown)");
    expect(queuedLine(text)).toBe(`Queued: 1 test file: ${FAST}`);
    expect(json.testFilesByPhase).toEqual({ running: 0, queued: 1, onRequest: 98 });
  });

  it("counts a commit group's held files on request too (`heldUntilAsked`)", () => {
    const { json } = read(held("commit"));
    expect(json.testFilesByPhase).toEqual({ running: 0, queued: 0, onRequest: 98 });
  });

  it("keeps a held file a request asked for at its key queued, and only that one", () => {
    const s = held();
    const asked = FILES.slice(0, 2);
    publishNarrowAsks(
      s.store,
      s.repo.mainId,
      asked.map((path) => [id(path), `key-${path}`] as const),
      NOW as EpochMs,
    );
    const { text, json } = read(s);
    expect(headline(text)).toContain("(2 queued, 96 on request, 3 unknown)");
    expect(json.testFilesByPhase).toEqual({ running: 0, queued: 2, onRequest: 96 });
    expect(queuedLine(text)).toBe(`Queued: 2 test files: ${asked.join(", ")}`);
  });

  it("keeps a held file asked at a key it left on request", () => {
    const s = held();
    const [first = ""] = FILES;
    publishNarrowAsks(s.store, s.repo.mainId, [[id(first), "old-key"]], NOW as EpochMs);
    expect(read(s).json.testFilesByPhase).toEqual({ running: 0, queued: 0, onRequest: 98 });
  });

  it("keeps held files not asked on request while the lane runs a narrow request", () => {
    const s = held();
    const [first = "", second = ""] = FILES;
    keys(s.store, s.repo, { [first]: "running" });
    publishNarrowAsks(
      s.store,
      s.repo.mainId,
      [
        [id(first), `key-${first}`],
        [id(second), `key-${second}`],
      ],
      NOW as EpochMs,
    );
    const running = { kind: "running", path: first, since: NOW - 1_000, lastDurationMs: null };
    publishGroupActivity(s.store, s.repo.mainId, "browser", running as never);
    expect(read(s).json.testFilesByPhase).toEqual({ running: 1, queued: 1, onRequest: 96 });
  });

  it("counts every held file queued while the lane runs a request for the whole group", () => {
    // `squeal run browser`: the lane runs, and no narrow ask names a file of it.
    const s = held();
    const [first = ""] = FILES;
    keys(s.store, s.repo, { [first]: "running" });
    const running = { kind: "running", path: first, since: NOW - 1_000, lastDurationMs: null };
    publishGroupActivity(s.store, s.repo.mainId, "browser", running as never);
    const { text, json } = read(s);
    expect(json.testFilesByPhase).toEqual({ running: 1, queued: 97 });
    expect(json.pendingTestFiles?.onRequest).toBeUndefined();
    expect(text).not.toContain("on request,");
  });

  it("counts every held file queued while a `run --all` checkpoint is owed", () => {
    const s = held();
    writeCheckpointProgress(s.store, s.repo.mainId, {
      id: "cp-1",
      kind: "run-all",
      revision: 3,
      startedAt: (NOW - 5_000) as EpochMs,
      done: 0,
      total: 98,
      owed: { ids: [], remaining: [], strict: [] },
    } as never);
    expect(read(s).json.testFilesByPhase).toEqual({ running: 0, queued: 98 });
  });

  it("adds no onRequest field without a held group", () => {
    const s = seed(null, { revisions: 3 });
    keys(s.store, s.repo, { [FAST]: "queued" });
    const { json } = read(s);
    expect(json.testFilesByPhase).toEqual({ running: 0, queued: 1 });
    expect(json.pendingTestFiles).not.toHaveProperty("onRequest");
  });
});
