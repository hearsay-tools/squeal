import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCodeStoreOpenFailure, openCodeStore } from "../../../src/core/code/store/index.js";
import type { CodeStore } from "../../../src/core/code/store/types.js";
import { createDelivery } from "../../../src/core/delivery/index.js";
import { formatStatus, readStatus } from "../../../src/core/status/index.js";
import type { StatusSnapshot } from "../../../src/core/types/index.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { NOW, type Seeded, seed } from "../../status/slow-tier-seed.js";
import { ON } from "../helpers.js";
import { codeState, codeTransition, fn, fnCheck, putFile, TIERS } from "./helpers.js";

/* Spec 015 D6: status's complexity line and its `code` JSON. */

const SELECT = fnCheck("selectTier");
const PLAN = fnCheck("planTier");
const RANK = fnCheck("rankTier");

function openCode(s: Seeded): CodeStore {
  const code = openCodeStore(s.repo.commonDir, ON);
  if (isCodeStoreOpenFailure(code)) throw new Error(JSON.stringify(code));
  return code;
}

/**
 * Three functions over 20: `planTier` failing before anyone registered,
 * `selectTier` gone over after session s1 registered, `rankTier` after s2.
 */
async function seeded(policy: object = { complexity: { enabled: true } }) {
  const s = seed(policy);
  const id = s.repo.mainId;
  const code = openCode(s);
  putFile(code, id, TIERS, [
    fn("planTier", 30, 40),
    fn("rankTier", 25, 80),
    fn("selectTier", 23, 120),
  ]);
  code.states.upsertMany([
    codeState(id, PLAN, 30),
    codeState(id, SELECT, 23),
    codeState(id, RANK, 25),
  ]);
  code.transitions.append([
    codeTransition(id, PLAN, "first-seen-fail", { from: null, to: 30, at: 1, revision: 1 }),
  ]);
  const delivery = createDelivery(s.store, { status: fixedStatus(), now: () => NOW });
  await delivery.register({ worktreeId: id, sessionId: "s1", agentId: "main" });
  code.transitions.append([
    codeTransition(id, SELECT, "pass-to-fail", { from: 18, to: 23, at: 2, revision: 3 }),
  ]);
  appendRevision(s, 3);
  await delivery.register({ worktreeId: id, sessionId: "s2", agentId: "main" });
  code.transitions.append([
    codeTransition(id, RANK, "pass-to-fail", { from: 18, to: 25, at: 3, revision: 4 }),
  ]);
  code.close();
  return s;
}

function appendRevision(s: Seeded, n: number) {
  s.store.revisions.append({
    worktreeId: s.repo.mainId,
    createdAt: n,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path: "src/a.ts", oldHash: null, newHash: `h${n}` }],
  });
}

function statusOf(s: Seeded, session: string | null) {
  const snapshot = readStatus(s.repo.main, {
    now: () => NOW,
    shell: { session, agent: null },
  }) as StatusSnapshot;
  return { snapshot, lines: formatStatus(snapshot, NOW).split("\n") };
}

describe("status's complexity line (015 D6)", () => {
  it("counts the functions over and those gone over since the shell's session started", async () => {
    const s = await seeded();
    const { snapshot, lines } = statusOf(s, "s1");
    expect(snapshot.code).toEqual({
      v: 1,
      threshold: 20,
      over: 3,
      sinceRegistration: 2,
      since: "session",
      pending: 0,
      files: 1,
      unknown: 0,
    });
    expect(lines).toContain(
      "Complexity: 3 functions over 20, 2 since this session started; squeal code lists them.",
    );
    expect(statusOf(s, "s2").snapshot.code?.sinceRegistration).toBe(1);
  });

  it("counts from the oldest registration when the shell names no session, and says so", async () => {
    const s = await seeded();
    const { snapshot, lines } = statusOf(s, null);
    expect(snapshot.code).toMatchObject({ sinceRegistration: 2, since: "oldest" });
    expect(lines).toContain(
      "Complexity: 3 functions over 20, 2 since the oldest registered session started; squeal code lists them.",
    );
  });

  it("says the count is running", async () => {
    const s = await seeded();
    const code = openCode(s);
    code.files.upsertMany(s.repo.mainId, [
      {
        path: "src/b.ts",
        blob: "b9",
        language: "typescript",
        counterVersion: 1,
        size: 9,
        revision: 1,
      },
    ]);
    code.close();
    expect(statusOf(s, "s1").lines).toContain(
      "Complexity: 3 functions over 20, 2 since this session started; counting, 1 of 2 files; squeal code lists them.",
    );
  });

  it("says only how far the first count is, with no number over yet (D6, lessons round 1)", () => {
    const s = seed({ complexity: { enabled: true } });
    const code = openCode(s);
    // The pass writes the files rows first, the counts by slice, and the states last.
    putFile(code, s.repo.mainId, TIERS, [fn("selectTier", 23, 120)]);
    code.files.upsertMany(s.repo.mainId, [
      {
        path: "src/b.ts",
        blob: "b9",
        language: "typescript",
        counterVersion: 1,
        size: 9,
        revision: 1,
      },
    ]);
    code.close();
    const { snapshot, lines } = statusOf(s, null);
    expect(snapshot.code).toMatchObject({ over: 0, pending: 1, files: 2 });
    expect(lines).toContain("Complexity: counting, 1 of 2 files.");
    expect(lines.join("\n")).not.toContain("0 functions over");
  });

  it("says nothing was counted while no daemon made the code store", () => {
    const s = seed({ complexity: { enabled: true } });
    const { snapshot, lines } = statusOf(s, null);
    expect(snapshot.code).toMatchObject({ over: 0, files: 0, since: null });
    expect(lines).toContain("Complexity: no file counted yet.");
  });

  it("is byte-identical with the policy off, whatever the code store holds (goal 1)", async () => {
    const s = await seeded();
    writeFileSync(join(s.repo.main, "squeal.config.json"), JSON.stringify({}));
    const withRows = statusOf(s, "s1");
    expect("code" in withRows.snapshot).toBe(false);
    expect(withRows.lines.some((l) => l.startsWith("Complexity"))).toBe(false);
    const fresh = seed({});
    const plain = statusOf(fresh, "s1");
    expect(Object.keys(withRows.snapshot).sort()).toEqual(Object.keys(plain.snapshot).sort());
    expect(withRows.lines.length).toBe(plain.lines.length);
  });
});
