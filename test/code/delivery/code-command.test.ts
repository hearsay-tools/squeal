import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../../../src/core/code/store/index.js";
import { createDelivery } from "../../../src/core/delivery/index.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { NOW, type Seeded, seed } from "../../status/slow-tier-seed.js";
import { ON } from "../helpers.js";
import { codeState, codeTransition, fn, fnCheck, putFile, TIERS } from "./helpers.js";

/* Spec 015 D6: `squeal code [<path>...] [--changed] [--json]`. */

const LEDGER = "src/ledger.ts";

/**
 * `planTier` over since revision 1, `selectTier` over since revision 3,
 * after session s1 registered at revision 2; `settle` at or under in
 * ledger.ts; a file too big to count is not in wave 1's files table yet,
 * so one not counted stands for the files listed after the functions.
 */
async function seeded(): Promise<Seeded> {
  const s = seed({ complexity: { enabled: true } });
  const id = s.repo.mainId;
  const code = openCodeStore(s.repo.commonDir, ON);
  if (isCodeStoreOpenFailure(code)) throw new Error(JSON.stringify(code));
  putFile(code, id, TIERS, [
    { ...fn("planTier", 30, 40), decisions: { if: 20, logical: 9 } },
    fn("selectTier", 23, 120),
  ]);
  putFile(code, id, LEDGER, [fn("settle", 4, 10)]);
  code.files.upsertMany(id, [
    {
      path: "src/new.ts",
      blob: "new",
      language: "typescript",
      counterVersion: 1,
      size: 9,
      revision: 3,
    },
  ]);
  code.states.upsertMany([
    codeState(id, fnCheck("planTier"), 30, { revision: 1 }),
    codeState(id, fnCheck("selectTier"), 23, { revision: 3 }),
    codeState(id, fnCheck("settle", LEDGER), 4),
  ]);
  await createDelivery(s.store, { status: fixedStatus(), now: () => NOW }).register({
    worktreeId: id,
    sessionId: "s1",
    agentId: "main",
  });
  code.transitions.append([
    codeTransition(id, fnCheck("selectTier"), "pass-to-fail", {
      from: 18,
      to: 23,
      at: 5,
      revision: 3,
    }),
  ]);
  code.close();
  return s;
}

function run(s: Seeded, args: string[], env: Record<string, string> = {}) {
  let out = "";
  const code = main(["code", ...args], {
    stdout: (t) => {
      out += t;
    },
    stderr: () => {},
    cwd: s.repo.main,
    env,
  });
  return { code, out };
}

describe("squeal code (015 D6)", () => {
  it("lists every function over the threshold, newest first, in a versioned JSON shape", async () => {
    const s = await seeded();
    const { code, out } = run(s, ["--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      v: 1,
      available: true,
      threshold: 20,
      maxFileBytes: 524_288,
      paths: null,
      functions: [
        {
          path: TIERS,
          qualifiedName: "selectTier",
          occurrence: 0,
          line: 120,
          outcome: "fail",
          complexity: 23,
          threshold: 20,
          decisions: { if: 22 },
          changedAt: 3,
        },
        {
          path: TIERS,
          qualifiedName: "planTier",
          occurrence: 0,
          line: 40,
          outcome: "fail",
          complexity: 30,
          threshold: 20,
          decisions: { if: 20, logical: 9 },
          changedAt: 1,
        },
      ],
      files: [{ path: "src/new.ts", reason: "not-counted", size: 9 }],
    });
  });

  it("prints each function's location, complexity, decisions and revision, then the files not judged", async () => {
    const s = await seeded();
    expect(run(s, []).out).toBe(
      [
        "Complexity: 2 functions over 20",
        "  src/core/scheduler/tiers.ts:120  selectTier  CC 23 (if 22), over since revision 3",
        "  src/core/scheduler/tiers.ts:40  planTier  CC 30 (if 20, logical 9), over since revision 1",
        "Not judged:",
        "  src/new.ts: not counted yet",
        "",
      ].join("\n"),
    );
  });

  it("lists every function of the files a path names, over the threshold or not", async () => {
    const s = await seeded();
    const report = JSON.parse(run(s, ["src/ledger.ts", "--json"]).out);
    expect(report.paths).toEqual([LEDGER]);
    expect(
      report.functions.map((f: { qualifiedName: string; outcome: string }) => [
        f.qualifiedName,
        f.outcome,
      ]),
    ).toEqual([["settle", "pass"]]);
    expect(report.files).toEqual([]);
    const all = JSON.parse(run(s, ["src", "--json"]).out);
    expect(all.functions).toHaveLength(3);
  });

  it("keeps what changed since the shell's session registered with --changed", async () => {
    const s = await seeded();
    const report = JSON.parse(
      run(s, ["--changed", "--json"], { CLAUDE_CODE_SESSION_ID: "s1" }).out,
    );
    expect(report.changedSince).toEqual({ revision: 2, scope: "session" });
    expect(report.functions.map((f: { qualifiedName: string }) => f.qualifiedName)).toEqual([
      "selectTier",
    ]);
    expect(run(s, ["--changed"], { CLAUDE_CODE_SESSION_ID: "s1" }).out.split("\n")[1]).toBe(
      "Changed since revision 2, when this session registered.",
    );
  });

  it("answers 1 with the reason while complexity is off, and 2 on an unknown option", async () => {
    const s = await seeded();
    writeFileSync(join(s.repo.main, "squeal.config.json"), "{}");
    expect(run(s, [])).toEqual({
      code: 1,
      out: "Complexity is off: complexity.enabled is not true in squeal.config.json.\n",
    });
    expect(JSON.parse(run(s, ["--json"]).out)).toMatchObject({ v: 1, available: false });
    expect(run(s, ["--all"]).code).toBe(2);
  });
});
