import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CodeCommandOptions, codeCommand } from "../../../src/cli/code.js";
import { countFile } from "../../../src/core/code/count/index.js";
import { type FailedCount, writeUncountable } from "../../../src/core/code/pass/failed.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../../../src/core/code/store/index.js";
import type { CodeStore } from "../../../src/core/code/store/types.js";
import { codeSource } from "../../../src/core/delivery/code-source.js";
import { createDelivery, formatRegistration } from "../../../src/core/delivery/index.js";
import { formatStatus, readStatus } from "../../../src/core/status/index.js";
import type { StatusSnapshot } from "../../../src/core/types/index.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { NOW, type Seeded, seed } from "../../status/slow-tier-seed.js";
import { ON } from "../helpers.js";
import { codeState, fnCheck } from "./helpers.js";

/*
 * Row 015-18: a file the counter failed on at every attempt reads
 * `unknown: could not count (<error>)` in `squeal code`, leaves `counting:
 * N of M` and is `uncountable` in status. While a retry is to come it reads
 * pending, as before.
 */

const RUN = "src/run.ts";
const OK = "src/ok.ts";
const LATER = "src/later.ts";
const BEFORE = "export function run(a) {\n  if (a) return 1;\n  return 0;\n}\n";
const AFTER = "export function run(a, b) {\n  if (a) return 1;\n  if (b) return 2;\n}\n";
const SETTLED = "export function ok() {\n  return 0;\n}\n";
const ERROR = "tree-sitter: out of memory";

function openCode(s: Seeded): CodeStore {
  const code = openCodeStore(s.repo.commonDir, ON);
  if (isCodeStoreOpenFailure(code)) throw new Error(JSON.stringify(code));
  return code;
}

/** The files row of `text` at `revision`, its count stored and its functions judged unless `count` is false. */
async function stored(s: Seeded, path: string, text: string, revision: number, count = true) {
  const code = openCode(s);
  const counted = await countFile(text, "typescript");
  const size = Buffer.byteLength(text);
  code.files.upsertMany(s.repo.mainId, [
    {
      path,
      blob: counted.blob,
      language: "typescript",
      counterVersion: counted.counterVersion,
      size,
      revision,
    },
  ]);
  if (count) {
    code.counts.put(counted, 1_000);
    code.states.upsertMany(
      counted.functions.map((f) => ({
        ...codeState(s.repo.mainId, fnCheck(f.qualifiedName, path), f.complexity, { revision }),
        blob: counted.blob,
      })),
    );
  }
  code.close();
  return counted.blob;
}

/**
 * `run` and `ok` counted at revision 2, then `run.ts` edited and its count
 * failed at revision 3: `retryAt` `null` once the attempts are spent.
 */
async function failed(retryAt: number | null): Promise<Seeded> {
  const s = seed({ complexity: { enabled: true } });
  mkdirSync(join(s.repo.main, "src"));
  writeFileSync(join(s.repo.main, OK), SETTLED);
  writeFileSync(join(s.repo.main, RUN), AFTER);
  await stored(s, RUN, BEFORE, 2);
  await stored(s, OK, SETTLED, 2);
  const blob = await stored(s, RUN, AFTER, 3, false);
  const code = openCode(s);
  const record: FailedCount = { blob, attempts: retryAt === null ? 3 : 1, retryAt, error: ERROR };
  writeUncountable(code.meta, s.repo.mainId, new Map([[RUN, record]]));
  code.close();
  return s;
}

function command(s: Seeded, args: string[], options?: CodeCommandOptions) {
  let out = "";
  const io = {
    stdout: (t: string) => {
      out += t;
    },
    stderr: () => {},
    cwd: s.repo.main,
    env: {},
  };
  return { exit: codeCommand(args, io, options), out: () => out };
}

/** A live daemon whose pass never comes: `squeal code` waits for a pending file up to `settleMs`. */
const live = (settleMs: number): CodeCommandOptions => ({
  settleMs,
  pollMs: 10,
  now: () => NOW,
  sync: () => ({ current: () => ({ state: "pending" }), stop: () => {} }),
});

function statusOf(s: Seeded) {
  const snapshot = readStatus(s.repo.main, {
    now: () => NOW,
    shell: { session: null, agent: null },
  }) as StatusSnapshot;
  return { code: snapshot.code, lines: formatStatus(snapshot, NOW).split("\n") };
}

const registration = async (s: Seeded) =>
  formatRegistration(
    await createDelivery(s.store, {
      status: fixedStatus(),
      now: () => NOW,
      code: codeSource(s.repo.commonDir, s.repo.main),
    }).register({
      worktreeId: s.repo.mainId,
      sessionId: "s1",
      agentId: "main",
    }),
  );

describe("a file the counter failed on at every attempt (row 015-18)", () => {
  it("reads unknown: could not count in squeal code, in text and JSON, with no wait", async () => {
    const s = await failed(null);
    const started = performance.now();
    const text = command(s, [RUN], live(5_000));
    expect(await text.exit).toBe(0);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(text.out()).toBe(
      [
        "Complexity: 0 functions in src/run.ts, threshold 20",
        "Not judged:",
        `  src/run.ts: unknown: could not count (${ERROR})`,
        "",
      ].join("\n"),
    );
    const json = command(s, ["src", "--json"]);
    expect(await json.exit).toBe(0);
    const report = JSON.parse(json.out());
    expect(report.functions.map((f: { qualifiedName: string }) => f.qualifiedName)).toEqual(["ok"]);
    expect(report.files).toEqual([
      { path: RUN, reason: "could-not-count", size: Buffer.byteLength(AFTER), error: ERROR },
    ]);
  });

  it("leaves status's counting and is uncountable in its JSON", async () => {
    const { code, lines } = statusOf(await failed(null));
    expect(code).toMatchObject({ pending: 0, files: 1, unknown: 0, uncountable: 1 });
    expect(lines).toContain(
      "Complexity: 0 functions over 20; 1 file could not be counted; squeal code lists them.",
    );
  });

  it("keeps the files it could not count in status's line while another file is pending", async () => {
    const s = await failed(null);
    writeFileSync(join(s.repo.main, LATER), SETTLED);
    await stored(s, LATER, `${SETTLED}// later\n`, 3, false);
    const { code, lines } = statusOf(s);
    expect(code).toMatchObject({ over: 0, pending: 1, files: 2, uncountable: 1 });
    // Review 0.1.293 S1.
    expect(lines).toContain("Complexity: counting, 1 of 2 files; 1 file could not be counted.");
  });

  it("leaves the registration's counting", async () => {
    const text = await registration(await failed(null));
    expect(text).not.toContain("counting");
    expect(text).toContain("\nComplexity: 0 functions over 20");
  });

  it("reads pending, and counting, while a retry is to come", async () => {
    const s = await failed(NOW + 5_000);
    const json = command(s, [RUN, "--json"]);
    expect(await json.exit).toBe(0);
    expect(JSON.parse(json.out()).files).toEqual([
      { path: RUN, reason: "pending", size: Buffer.byteLength(AFTER), revision: 2 },
    ]);
    const { code } = statusOf(s);
    expect(code).toMatchObject({ pending: 1, files: 2 });
    expect(code).not.toHaveProperty("uncountable");
    expect(await registration(s)).toContain("\nComplexity: counting, 1 of 2 files.");
  });

  it("reads pending again once the file's bytes change", async () => {
    const s = await failed(null);
    writeFileSync(join(s.repo.main, RUN), BEFORE.replace("1", "2"));
    const json = command(s, [RUN, "--json"]);
    expect(await json.exit).toBe(0);
    expect(JSON.parse(json.out()).files).toMatchObject([{ path: RUN, reason: "pending" }]);
  });
});
