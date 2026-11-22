import { describe, expect, it } from "vitest";
import { type AtAskPorts, AtAsks, type AtRow, choose } from "../../src/core/daemon/at-asks.js";
import { CommitDesk } from "../../src/core/daemon/commit-desk.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import type { CommitAskRequest, CommitSetup } from "../../src/core/types/commit-ask.js";
import type { RelativePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";

/*
 * Spec 023 D7.3 as amended 2026-11-21 (row 023-40c): a commit daemon's
 * asks. D4.5's selection at the commit, as the call's keying chose before:
 * the call's paths narrow the candidates, a test file named by its own path
 * runs whatever the change, the others run when the change selects them,
 * when they have no key, or with `--all-missing`; a file with a result at
 * its live key never. An ask is kept at once and queued once the daemon's
 * start settled; a failed setup fails it with its text. The socket side
 * answers from the main thread's last snapshot.
 */

const ref = (path: string): TestFileRef => ({ project: "", path });
const A = ref("test/a.test.ts");
const B = ref("test/b.test.ts");
const C = ref("test/c/c.test.ts");
const D = ref("test/d.test.ts");

const ask = (over: Partial<CommitAskRequest> = {}): CommitAskRequest => ({
  type: "commit-ask",
  owner: "call-1",
  changed: ["src/a.ts"],
  named: [],
  allMissing: false,
  ...over,
});

/**
 * Ports over `rows`; `src/a.ts` is read by A, `src/c.ts` by C; `stored`
 * keys have a result; `needs` names the files whose closure reads a path git
 * does not hold at the commit (D4.9).
 */
function ports(
  rows: readonly AtRow[],
  stored: ReadonlySet<string> = new Set(),
  needs: ReadonlyMap<string, RelativePath> = new Map(),
) {
  const requests: { group: string; paths: readonly RelativePath[]; lead?: boolean }[] = [];
  let setup: CommitSetup = { phase: "install" };
  let settle: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    settle = resolve;
  });
  let changes = 0;
  const readers: Record<string, TestFileRef[]> = { "src/a.ts": [A], "src/c.ts": [C] };
  const value: AtAskPorts = {
    setup: () => setup,
    started: () => started,
    changedSelects: async (paths) =>
      paths.flatMap(
        (p) => readers[p] ?? rows.filter((r) => r.testFile.path === p).map((r) => r.testFile),
      ),
    rows: () => rows,
    stored: (_ref, key) => stored.has(key),
    needs: async () => needs,
    groupOf: (r) => (r.path.startsWith("test/c/") ? "slow" : "tests"),
    request: async (group, paths, options) => {
      requests.push({
        group,
        paths,
        ...(options.lead === undefined ? {} : { lead: options.lead }),
      });
    },
    changed: () => {
      changes += 1;
    },
  };
  return {
    value,
    requests,
    changes: () => changes,
    ready: () => {
      setup = { phase: "ready" };
      settle();
    },
    fail: (text: string) => {
      setup = { phase: "failed", text };
      settle();
    },
  };
}

const row = (testFile: TestFileRef, key: string | null = `k-${testFile.path}`): AtRow => ({
  testFile,
  key,
  pending: null,
});
const paths = (refs: readonly TestFileRef[]) => refs.map((r) => r.path);

describe("D4.5 at the commit daemon (row 023-40c)", () => {
  it("runs what the change selects with no result; a stored result and an unselected file stay", async () => {
    const p = ports([row(A), row(B), row(C)], new Set(["k-test/c/c.test.ts"]));
    const chosen = await choose(ask({ changed: ["src/a.ts", "src/c.ts"] }), p.value);
    expect(paths(chosen?.named ?? [])).toEqual([]);
    expect(paths(chosen?.rest ?? [])).toEqual([A.path]);
  });

  it("runs a file with no key, which no closure index holds, and every one with --all-missing", async () => {
    const p = ports([row(A), row(B, null), row(D)]);
    expect(paths((await choose(ask(), p.value))?.rest ?? [])).toEqual([A.path, B.path]);
    const all = await choose(ask({ allMissing: true, changed: [] }), p.value);
    expect(paths(all?.rest ?? [])).toEqual([A.path, B.path, D.path]);
  });

  it("runs a file named by its own path first, whatever the change; a named folder narrows and forces none", async () => {
    const p = ports([row(A), row(B), row(C)]);
    const named = await choose(ask({ named: [B.path] }), p.value);
    expect(paths(named?.named ?? [])).toEqual([B.path]);
    expect(paths(named?.rest ?? [])).toEqual([]);
    const folder = await choose(ask({ named: ["test/c"], changed: ["src/a.ts"] }), p.value);
    expect(paths(folder?.named ?? [])).toEqual([]);
    expect(paths(folder?.rest ?? [])).toEqual([]);
    const folderChanged = await choose(ask({ named: ["test/c"], changed: ["src/c.ts"] }), p.value);
    expect(paths(folderChanged?.rest ?? [])).toEqual([C.path]);
  });

  it("counts the change's whole selection, results and the call's paths aside (row 023-53, V8)", async () => {
    // A is read by src/a.ts and has a result; B has no key; D is not selected.
    const p = ports([row(A), row(B, null), row(D)], new Set(["k-test/a.test.ts"]));
    expect((await choose(ask({ named: [D.path] }), p.value))?.selects).toBe(2);
    expect((await choose(ask({ allMissing: true }), p.value))?.selects).toBe(2);
  });

  it("refuses a chosen file whose closure reads a path git does not hold, and its path's other projects (D4.9)", async () => {
    const other: TestFileRef = { project: "other", path: A.path };
    const p = ports(
      [row(A), row(other), row(B)],
      new Set(),
      new Map([[testFileId(A), "src/gen.ts"]]),
    );
    const chosen = await choose(ask({ allMissing: true, changed: [] }), p.value);
    expect(paths(chosen?.rest ?? [])).toEqual([B.path]);
    expect(chosen?.refused).toEqual([
      { ref: A, reason: "needs src/gen.ts" },
      { ref: other, reason: `it runs with the default project's ${A.path}: needs src/gen.ts` },
    ]);
  });

  it("names the readers of a named path that is no test file", async () => {
    const p = ports([row(A), row(B)]);
    const chosen = await choose(ask({ named: ["src/a.ts"], changed: ["src/a.ts"] }), p.value);
    expect(chosen?.readers).toEqual({ "src/a.ts": [A] });
    expect(paths(chosen?.rest ?? [])).toEqual([A.path]);
  });
});

describe("a commit daemon's asks (row 023-40c)", () => {
  it("keeps an ask at once, queues it once the start settled, named files first and leading", async () => {
    const p = ports([row(A), row(B), row(C)]);
    const asks = new AtAsks(p.value);
    asks.ask(ask({ named: [B.path, C.path], changed: [] }));
    asks.ask(ask({ named: [B.path, C.path], changed: [] }));
    expect(asks.snapshot()).toMatchObject({
      setup: { phase: "install" },
      asks: [{ owner: "call-1", phase: "waiting", files: [] }],
    });
    p.ready();
    await expect.poll(() => asks.snapshot().asks[0]?.phase).toBe("queued");
    expect(paths(asks.snapshot().asks[0]?.files ?? [])).toEqual([B.path, C.path]);
    expect(p.requests).toEqual([
      { group: "tests", paths: [B.path], lead: true },
      { group: "slow", paths: [C.path], lead: true },
    ]);
    expect(p.changes()).toBeGreaterThanOrEqual(3);
  });

  it("row 023-50 (V3): leads with the files under a named folder and a named path's readers, named files first", async () => {
    const p = ports([row(A), row(B), row(C), row(D)]);
    const asks = new AtAsks(p.value);
    asks.ask(ask({ named: [D.path, "test/c", "src/a.ts"], changed: ["src/a.ts", "src/c.ts"] }));
    p.ready();
    await expect.poll(() => asks.snapshot().asks[0]?.phase).toBe("queued");
    expect(paths(asks.snapshot().asks[0]?.files ?? [])).toEqual([D.path, A.path, C.path]);
    expect(p.requests).toEqual([
      { group: "tests", paths: [D.path, A.path], lead: true },
      { group: "slow", paths: [C.path], lead: true },
    ]);
  });

  it("leads with nothing in a call that names no path", async () => {
    const p = ports([row(A), row(B)]);
    const asks = new AtAsks(p.value);
    asks.ask(ask());
    p.ready();
    await expect.poll(() => asks.snapshot().asks[0]?.phase).toBe("queued");
    expect(p.requests).toEqual([{ group: "tests", paths: [A.path] }]);
  });

  it("fails an ask with the setup's text when the install failed", async () => {
    const p = ports([row(A)]);
    const asks = new AtAsks(p.value);
    asks.ask(ask());
    p.fail("install: pnpm install --frozen-lockfile: exit 1");
    await expect.poll(() => asks.snapshot().asks[0]?.phase).toBe("failed");
    expect(asks.snapshot().asks[0]?.text).toBe("install: pnpm install --frozen-lockfile: exit 1");
    expect(p.requests).toEqual([]);
  });

  it("answers reads on the socket side from the last snapshot, a forwarded ask as waiting", () => {
    const forwarded: CommitAskRequest[] = [];
    const desk = new CommitDesk((request) => forwarded.push(request));
    expect(desk.ask(ask()).owner).toBe("call-1");
    desk.ask(ask());
    expect(forwarded).toHaveLength(1);
    expect(desk.read({ type: "commit-read" })).toMatchObject({
      setup: { phase: "install" },
      asks: [{ owner: "call-1", phase: "waiting" }],
    });
    desk.set({
      setup: { phase: "ready" },
      asks: [{ owner: "call-1", phase: "queued", files: [A], readers: {}, problems: [] }],
    });
    expect(desk.read({ type: "commit-read", owners: ["call-1"] }).asks).toEqual([
      { owner: "call-1", phase: "queued", files: [A], readers: {}, problems: [] },
    ]);
    expect(desk.read({ type: "commit-read", owners: ["other"] }).asks).toEqual([]);
  });

  it("parses an ask and a read, and refuses a malformed one", () => {
    const line = JSON.stringify(ask({ named: [A.path] }));
    expect(parseRequest(line)).toEqual(ask({ named: [A.path] }));
    expect(parseRequest(JSON.stringify({ type: "commit-read" }))).toEqual({ type: "commit-read" });
    expect(parseRequest(JSON.stringify({ type: "commit-read", owners: ["x"] }))).toEqual({
      type: "commit-read",
      owners: ["x"],
    });
    expect(parseRequest(JSON.stringify({ ...ask(), allMissing: "yes" }))).toBe(
      '"allMissing" must be true or false',
    );
  });
});
