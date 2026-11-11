import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { type FixtureRepo, waitFor, withStore } from "../daemon/helpers.js";
import {
  featureRepo,
  gate,
  hasRecord,
  keepPolicy,
  keysNow,
  runIdsAt,
} from "./code-gate-keep-kit.js";

/*
 * Review 0.1.433 B1 (spec 020 D17.3): the gate keeps a file only when its
 * keyed inputs held still for the whole run, as the daemon's completion
 * barrier does (`scheduler/stability.ts`): an input that changed during
 * the run, or was written and ended as it was, keeps the file out. Here a
 * test writes other bytes into its declared input, reads them, and puts
 * the input back. Its key is the key the run started under, but the run
 * did not test those bytes, so nothing is kept there. A steady sibling in
 * the same run is kept.
 */

const SLOW = { timeout: 300_000 } as const;

const INPUT: TestFileRef = { project: "", path: "test/input.test.ts" };
const STEADY: TestFileRef = { project: "", path: "test/steady.test.ts" };

/** `data/input.txt` is declared for the input test alone; nothing is observed at run time. */
const POLICY = keepPolicy("lookup-only", {
  observe: { runtimeInputs: false },
  inputs: { [INPUT.path]: ["data/input.txt"] },
});

/**
 * While `armed` exists, outside the worktree, the input test writes `good`
 * into its input, reads it, and writes `bad` back; otherwise it reads `bad`.
 * It passes only on `good`.
 */
const inputTest = (armed: string) =>
  `import { existsSync, readFileSync, writeFileSync } from "node:fs";\nimport { expect, it } from "vitest";\nimport { twice } from "../src/twice.ts";\n\nconst INPUT = new URL("../data/input.txt", import.meta.url);\n\nit("input", () => {\n  const armed = existsSync(${JSON.stringify(armed)});\n  if (armed) writeFileSync(INPUT, "good\\n");\n  const text = readFileSync(INPUT, "utf8");\n  if (armed) writeFileSync(INPUT, "bad\\n");\n  expect(twice(2)).toBe(4);\n  expect(text).toBe("good\\n");\n});\n`;

const STEADY_TEST = `import { expect, it } from "vitest";\nimport { twice } from "../src/twice.ts";\n\nit("steady", () => {\n  expect(twice(3)).toBe(6);\n});\n`;

describe("squeal code --base keeps no file whose input moved during its run (review 0.1.433 B1)", () => {
  let repo: FixtureRepo;
  let outside: string;
  let armed: string;

  beforeAll(() => {
    outside = mkdtempSync(join(tmpdir(), "squeal-keep-touched-"));
    armed = join(outside, "armed");
    repo = featureRepo(POLICY, {
      "src/twice.ts": "export const twice = (x: number) => x + x;\n",
      "data/input.txt": "bad\n",
      [INPUT.path]: inputTest(armed),
      [STEADY.path]: STEADY_TEST,
    });
  });

  afterAll(() => {
    repo?.cleanup();
    if (outside !== undefined) rmSync(outside, { recursive: true, force: true });
  });

  it("keeps the steady file and nothing at the key of the one put back", SLOW, async () => {
    const [input, steady] = (await keysNow(repo, [INPUT, STEADY])) as [CheckKey, CheckKey];
    writeFileSync(armed, "");
    let first: Awaited<ReturnType<typeof gate>>;
    try {
      first = await gate(repo, []);
    } finally {
      rmSync(armed, { force: true });
    }

    expect(first.code).toBe(0);
    expect(first.report.runs[0]?.completed).toEqual([INPUT.path, STEADY.path]);
    // The input ended as it was, so the key is the one the run started under.
    expect(readFileSync(join(repo.root, "data/input.txt"), "utf8")).toBe("bad\n");
    expect(await keysNow(repo, [INPUT])).toEqual([input]);
    expect([runIdsAt(repo, input), hasRecord(repo, input)]).toEqual([[], false]);
    expect(runIdsAt(repo, steady)).toHaveLength(1);
    expect(hasRecord(repo, steady)).toBe(true);
  });

  it("is not read as current by a daemon started afterwards", SLOW, async () => {
    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    let input: readonly { readonly validity: string }[];
    try {
      await daemon.ready;
      await waitFor(
        () =>
          withStore(repo, (store) => {
            const found = store.knownStates.list(repo.worktreeId, [STEADY]);
            return found.length > 0 && found.every((s) => s.validity === "current") ? found : null;
          }),
        120_000,
        "current states of the steady file",
      );
      input = withStore(repo, (store) => store.knownStates.list(repo.worktreeId, [INPUT]));
    } finally {
      await daemon.stop("stop-requested");
    }
    expect(input.filter((s) => s.validity === "current")).toEqual([]);
  });

  it("runs the file again on the same bytes, and it fails at them", SLOW, async () => {
    const second = await gate(repo, []);

    expect(second.ran).toEqual([INPUT.path]);
    expect(second.code).toBe(3);
    const [run] = second.report.runs;
    expect(run?.from).toEqual({ [INPUT.path]: "run", [STEADY.path]: "store" });
    expect(run?.failed).toEqual([{ path: INPUT.path, tests: ["input"] }]);
  });
});
