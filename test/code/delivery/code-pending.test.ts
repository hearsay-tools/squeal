import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CodeCommandOptions, codeCommand } from "../../../src/cli/code.js";
import { main } from "../../../src/cli/main.js";
import { statusCommand } from "../../../src/cli/status-command.js";
import { countFile } from "../../../src/core/code/count/index.js";
import { COVERAGE_RECORD_VERSION } from "../../../src/core/code/coverage/record.js";
import { writeSummary } from "../../../src/core/code/crap/summary.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../../../src/core/code/store/open.js";
import { NOW, type Seeded, seed } from "../../status/slow-tier-seed.js";
import { ON } from "../helpers.js";
import { codeState, fnCheck } from "./helpers.js";

/*
 * Row 015-22 (lessons, P4): `squeal code <path>` compares each file's bytes
 * with its counted blob. A file the pass has not counted since an edit is
 * `pending`, never its old counts; a live daemon's pass is waited for first.
 */

const RUN = "src/run.ts";
const OK = "src/ok.ts";
const BEFORE = "export function run(a) {\n  if (a) return 1;\n  return 0;\n}\n";
const AFTER =
  "export function run(a, b) {\n  if (a) return 1;\n  if (b) return 2;\n  return 0;\n}\n";
const SETTLED = "export function ok() {\n  return 0;\n}\n";

/**
 * Stores `text` as the pass does: the file at `revision` and its count, then
 * its functions' states unless `judged` is false, the pass's last write.
 */
async function counted(
  s: Seeded,
  path: string,
  text: string,
  revision: number,
  { judged = true } = {},
): Promise<void> {
  const code = openCodeStore(s.repo.commonDir, ON);
  if (isCodeStoreOpenFailure(code)) throw new Error(JSON.stringify(code));
  const count = await countFile(text, "typescript");
  code.files.upsertMany(s.repo.mainId, [
    {
      path,
      blob: count.blob,
      language: "typescript",
      counterVersion: count.counterVersion,
      size: Buffer.byteLength(text),
      revision,
    },
  ]);
  code.counts.put(count, 1_000);
  if (judged) {
    code.states.upsertMany(
      count.functions.map((f) => ({
        ...codeState(s.repo.mainId, fnCheck(f.qualifiedName, path), f.complexity, {
          threshold: 2,
          revision,
        }),
        blob: count.blob,
      })),
    );
  }
  code.close();
}

const write = (s: Seeded, path: string, text: string) =>
  writeFileSync(join(s.repo.main, path), text);

/** `run` at CC 2 and `ok` counted at revision 2; then `run.ts` edited to CC 3, with no pass. */
async function edited(): Promise<Seeded> {
  const s = seed({ complexity: { enabled: true, threshold: 2 } });
  mkdirSync(join(s.repo.main, "src"));
  write(s, RUN, BEFORE);
  write(s, OK, SETTLED);
  await counted(s, RUN, BEFORE, 2);
  await counted(s, OK, SETTLED, 2);
  write(s, RUN, AFTER);
  return s;
}

function command(
  s: Seeded,
  args: string[],
  options?: CodeCommandOptions,
  env: Record<string, string> = {},
) {
  let out = "";
  const exit = codeCommand(
    args,
    {
      stdout: (t) => {
        out += t;
      },
      stderr: () => {},
      cwd: s.repo.main,
      env,
    },
    options,
  );
  return { exit, out: () => out };
}

const PENDING = {
  path: RUN,
  reason: "pending",
  size: Buffer.byteLength(AFTER),
  revision: 2,
};

/** The seed's daemon heartbeat is fresh at `NOW`; its sync never answers. */
const live = (settleMs: number): CodeCommandOptions => ({
  settleMs,
  pollMs: 10,
  now: () => NOW,
  sync: () => ({ current: () => ({ state: "pending" }), stop: () => {} }),
});

describe("squeal code marks a count that is behind the file (row 015-22)", () => {
  it("prints an edited file as pending, not its old counts, in text and JSON", async () => {
    const s = await edited();
    let out = "";
    const io = {
      stdout: (t: string) => {
        out += t;
      },
      stderr: () => {},
      cwd: s.repo.main,
      env: {},
    };
    // No daemon validates at the real clock, so no pass can come: it answers at once.
    expect(main(["code", RUN], io)).toBe(0);
    expect(out).toBe(
      [
        "Complexity: 0 functions in src/run.ts, threshold 2",
        "Not judged:",
        "  src/run.ts: pending: changed since revision 2, not counted yet",
        "",
      ].join("\n"),
    );
    out = "";
    expect(main(["code", RUN, "--json"], io)).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ functions: [], files: [PENDING] });
  });

  it("keeps the counts of a file whose bytes are its counted blob", async () => {
    const s = await edited();
    const { exit, out } = command(s, ["src", "--json"]);
    expect(exit).toBe(0);
    const report = JSON.parse(out());
    expect(report.functions).toMatchObject([{ path: OK, qualifiedName: "ok", complexity: 1 }]);
    expect(report.files).toEqual([PENDING]);
  });

  it("keeps a file pending while the pass has stored its count but not judged it", async () => {
    const s = await edited();
    await counted(s, RUN, AFTER, 3, { judged: false });
    const { out } = command(s, [RUN, "--json"]);
    expect(JSON.parse(out())).toMatchObject({ functions: [], files: [PENDING] });
  });

  it("waits for a live daemon's pass and prints the new count", async () => {
    const s = await edited();
    const started = performance.now();
    const { exit, out } = command(s, [RUN], live(5_000));
    setTimeout(() => void counted(s, RUN, AFTER, 3), 50);
    expect(await exit).toBe(0);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(out()).toBe(
      [
        "Complexity: 1 function in src/run.ts, threshold 2",
        // Review 0.1.408 B1: coverage is on by default, and no coverage step ran here.
        "  src/run.ts:1  run  CC 3 (if 2), over since revision 3; CRAP pending: the coverage step has not judged this file's current bytes yet",
        "",
      ].join("\n"),
    );
  });

  it("prints the file as pending when the pass does not come within the wait", async () => {
    const s = await edited();
    const started = performance.now();
    const { exit, out } = command(s, [RUN, "--json"], live(100));
    expect(await exit).toBe(0);
    expect(performance.now() - started).toBeGreaterThanOrEqual(100);
    expect(JSON.parse(out())).toMatchObject({ functions: [], files: [PENDING] });
  });
});

describe("squeal code names the CLI as status does in a CRAP reason (review 0.1.408 B2)", () => {
  /** `ok` counted, its file waiting for one test file's run in the coverage summary. */
  async function waiting(): Promise<Seeded> {
    const s = seed({ complexity: { enabled: true, threshold: 2 } });
    mkdirSync(join(s.repo.main, "src"));
    write(s, OK, SETTLED);
    await counted(s, OK, SETTLED, 2);
    const code = openCodeStore(s.repo.commonDir, ON);
    if (isCodeStoreOpenFailure(code)) throw new Error(JSON.stringify(code));
    const [file] = code.files.list(s.repo.mainId, [OK]);
    writeSummary(code.meta, s.repo.mainId, {
      v: 1,
      since: 2,
      provider: COVERAGE_RECORD_VERSION,
      files: { [OK]: { state: "pending", blob: file?.blob ?? "", reason: "run", waiting: 1 } },
    });
    code.close();
    return s;
  }

  it.each([
    ["a plain shell", {}],
    ["a Codex shell", { CODEX_SESSION_ID: "t" }],
    ["a Pi shell", { PI_SESSION_ID: "p" }],
    ["an OpenCode shell", { OPENCODE_SESSION_ID: "o" }],
  ])("in %s", async (_, env: Record<string, string>) => {
    const s = await waiting();
    const named = statusCommand(env);
    const reason = `waits for a test file to run; ${named} run --all runs it`;
    const { exit, out } = command(s, [OK, "--json"], undefined, env);
    expect(await exit).toBe(0);
    expect(JSON.parse(out()).functions[0].coverage.crap).toEqual({
      outcome: "pending",
      value: null,
      reason,
    });
    const text = command(s, [OK], undefined, env);
    expect(await text.exit).toBe(0);
    expect(text.out()).toContain(`CRAP pending: ${reason}`);
  });
});
