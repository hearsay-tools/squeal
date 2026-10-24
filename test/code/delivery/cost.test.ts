import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCodeStoreOpenFailure, openCodeStore } from "../../../src/core/code/store/index.js";
import type { CodeStore } from "../../../src/core/code/store/types.js";
import type { CodeKnownState, FunctionCount } from "../../../src/core/types/code.js";
import { type HookDeps, runHook } from "../../../src/harness/claude-code/index.js";
import { recorded, type SquealRepo, squealRepo } from "../../harness/helpers.js";
import { ON } from "../helpers.js";
import { codeState, codeTransition, fn, fnCheck, putFile } from "./helpers.js";

/*
 * Lessons, round 1, P5 (cz6): a PostToolBatch with a code line took 1.05 s
 * at the median in cezar, about 16,250 functions, and one was cancelled at
 * its 2 s timeout. Here 20,000 functions, 500 of them over the threshold.
 */

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const FILES = 1_000;
const PER_FILE = 20;
const BOUND_MS = 300;

const pathOf = (i: number) => `src/m${i}.ts`;

/** `fn${j}` of file `i`; the first function of every other file is over 20. */
function functionsOf(i: number): FunctionCount[] {
  return Array.from({ length: PER_FILE }, (_, j) =>
    fn(`fn${j}`, j === 0 && i % 2 === 0 ? 25 : 5, 1 + j * 12),
  );
}

function bigStore(r: SquealRepo): CodeStore {
  writeFileSync(join(r.root, "squeal.config.json"), JSON.stringify({ complexity: ON.complexity }));
  const code = openCodeStore(r.repo.commonDir, ON);
  if (isCodeStoreOpenFailure(code)) throw new Error(JSON.stringify(code));
  code.transaction(() => {
    for (let i = 0; i < FILES; i++) {
      const functions = functionsOf(i);
      putFile(code, r.worktreeId, pathOf(i), functions);
      code.states.upsertMany(
        functions.map(
          (f): CodeKnownState =>
            codeState(r.worktreeId, fnCheck(f.qualifiedName, pathOf(i)), f.complexity),
        ),
      );
    }
  });
  return code;
}

describe("the cost of a code delivery (lessons round 1, P5)", () => {
  it("delivers one code transition on 20,000 functions within 0.3 s", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    const code = bigStore(r);
    await runHook("session-start", recorded("session-start", r.root), deps);
    // The pass after an edit that takes `fn1` of file 1 over the threshold.
    r.apply();
    const check = fnCheck("fn1", pathOf(1));
    code.transaction(() => {
      putFile(code, r.worktreeId, pathOf(1), [fn("fn0", 5, 1), fn("fn1", 23, 13)]);
      code.states.upsertMany([codeState(r.worktreeId, check, 23, { revision: 2 })]);
      code.transitions.append([
        codeTransition(r.worktreeId, check, "pass-to-fail", {
          from: 5,
          to: 23,
          at: Date.now() + 1_000,
          revision: 2,
        }),
      ]);
    });
    const started = performance.now();
    const batch = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps);
    const took = performance.now() - started;
    expect(batch.stdout).toContain("FAIL complexity: fn1 (src/m1.ts:13) is 23, over 20");
    expect(took).toBeLessThan(BOUND_MS);
  });
});
