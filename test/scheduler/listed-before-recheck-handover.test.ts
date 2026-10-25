import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import { rekeyedMovesMetaKey } from "../../src/core/scheduler/rekeyed-moves.js";
import type { Policy, RevisionNumber, TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { claimRepo, fileName, type Side, side } from "./claims-fixture.js";

/*
 * Row 011-227: a start under `lookup-only` commits its first lookup before
 * the recheck, and that commit resolves the open re-key move of a
 * handed-over file the first lookup hits. The handover reads the moves as
 * the last daemon left them (`handover`'s `open`), so the order of the work
 * it hands over equals a single commit's.
 *
 * The predecessor left N, M and H queued at R2. H's move is open at R1,
 * which edited `S` (H's import) and M itself; M's and N's at R2, which
 * edited their imports. Every key moved since (an adapter upgrade); a third
 * worktree stored H at its new key, so the first lookup hits H, and N and M
 * miss and are rechecked. R1 reached H within its move, so M counts as
 * edited and runs before N; read after the first commit, H's move would be
 * gone, R1 outside every range, and N would run first.
 */

const [N, M, H] = [0, 1, 2].map(fileName) as [string, string, string];
const [S, T, U] = ["src/s.ts", "src/t.ts", "src/u.ts"];
const IMPORTS: Readonly<Record<string, string>> = { [H]: S, [M]: T, [N]: U };
const SOURCES = { [S]: "export const s = 1;\n", [T]: "export const t = 1;\n", [U]: "1;\n" };
const LOOKUP_ONLY: Pick<Policy, "baseline"> = { baseline: { onStart: "lookup-only" } };
/** Real schedulers, a real store and git: a loaded host needs headroom. */
const SLOW = { timeout: 90_000 } as const;

/** Each test file imports its source; `adapterVersion` moves every key. */
function wire(s: Side, adapterVersion = "1"): void {
  s.runner.closure = async (testFile) => {
    const source = IMPORTS[testFile.path];
    return { testFile, paths: source === undefined ? [testFile.path] : [source, testFile.path] };
  };
  const environment = s.runner.environment;
  s.runner.environment = async () =>
    (await environment()).map((env) => ({ ...env, adapterVersion }));
}

/** Writes `paths` with new contents in `root`. */
function edit(root: string, ...paths: string[]): void {
  for (const path of paths) writeFileSync(join(root, path), `// edited ${path}\n`);
}

const latest = (s: Side): RevisionNumber => s.store.revisions.latest(s.worktreeId)?.number ?? 0;

describe("the handover after the first lookup's commit (011-227)", SLOW, () => {
  it("orders the handed-over work as of the moves before that commit", async () => {
    const { others } = claimRepo(3, SOURCES, 2);
    const [other, third] = others as [string, string];
    const p = side(other, { count: 3, policy: RUN_MISSING, rerunCap: 0 });
    wire(p);
    await p.scheduler.start();
    await p.scheduler.idle();
    edit(other, S, M);
    await p.batch(S, M);
    await p.scheduler.idle();
    const r1 = latest(p);
    edit(other, T, U);
    await p.batch(T, U);
    await p.scheduler.idle();
    const r2 = latest(p);
    expect(r2).toBeGreaterThan(r1);
    p.stopBeat();
    await p.scheduler.close();

    // The predecessor left all three queued at R2: H's move open at R1, M's and N's at R2.
    const id = p.worktreeId;
    const rows = p.store.testFileKeys.list(id);
    p.store.testFileKeys.upsertMany(
      rows.map((row) => ({ ...row, pending: "queued", revision: r2 })),
    );
    const moves = JSON.parse(p.store.meta.get(rekeyedMovesMetaKey(id)) ?? "{}");
    const open = (path: string, at: RevisionNumber) => {
      moves.files[testFileId({ project: "", path } as TestFileRef)] = {
        open: [at, at],
        resolved: {},
      };
    };
    open(H, r1);
    open(M, r2);
    open(N, r2);
    p.store.meta.set(rekeyedMovesMetaKey(id), JSON.stringify(moves));

    // A third worktree with the same contents stored H at the new key.
    edit(third, S, M, T, U);
    const c = side(third, { count: 3, policy: RUN_MISSING, rerunCap: 0 });
    wire(c, "2");
    c.runner.testFiles = async () => [{ project: "", path: H }];
    await c.scheduler.start();
    await c.scheduler.idle();
    expect(c.runner.ran(H)).toBe(1);

    const b = side(other, { count: 3, policy: LOOKUP_ONLY, rerunCap: 0, tierSize: 1 });
    wire(b, "2");
    await b.scheduler.start();
    await b.scheduler.idle();

    expect(b.keyOf(H)).toBe(c.keyOf(H));
    expect(b.runner.ran(H)).toBe(0);
    expect(b.runner.runs.map((files) => files.map((f) => f.path))).toEqual([[M], [N]]);
  });
});
