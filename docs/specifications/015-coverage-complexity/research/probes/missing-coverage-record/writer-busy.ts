// Throwaway probe (015-79). Run from the worktree root:
//   npx tsx docs/specifications/015-coverage-complexity/research/probes/missing-coverage-record/writer-busy.ts [holdMs]
// The records' writer from this baseline's sources (src/core/code/coverage/writer.ts) gets
// 12 completed test files whose results exist (resultKey always answers). A second process,
// as another daemon would, holds the code store's write lock for `holdMs` (default 6000)
// from the start. Prints per file whether a record was stored, when, and the writer's log.
// Then a control round with no holder. Everything lives in a fresh temp dir it deletes.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COVERAGE_PROVIDER_VERSION,
  type CoveredFile,
  createCoverageWriter,
} from "../../../../../../src/core/code/coverage/index.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../../../../../../src/core/code/store/index.js";
import { DEFAULT_POLICY, type Policy } from "../../../../../../src/core/types/index.js";

const ON: Policy = {
  ...DEFAULT_POLICY,
  complexity: { ...DEFAULT_POLICY.complexity, enabled: true },
  coverage: { ...DEFAULT_POLICY.coverage, enabled: true },
};
const FILES = 12;
const holdMs = Number(process.argv[2] ?? 6000);
const scratch = mkdtempSync(join(tmpdir(), "sq-015-79-"));

function payloadFile(dir: string, test: string): CoveredFile {
  const text = "f();\n";
  const path = join(dir, `${test}.src.js`);
  writeFileSync(path, text);
  const payload = join(dir, `${test}.payload.json`);
  const ranges = [{ startOffset: 0, endOffset: text.length, count: 1 }];
  writeFileSync(
    payload,
    JSON.stringify({ result: [{ url: `file://${path}`, functions: [{ functionName: "", ranges }] }] }),
  );
  const sha1 = createHash("sha1").update(text).digest("hex");
  return {
    testFile: { project: "", path: test },
    payload,
    sources: new Map([[path, { path: `${test}.src.js`, code: text, map: null, sha1 }]]),
  };
}

/** Another process that takes the code store's write lock and keeps it `ms`. */
function holdLock(db: string, ms: number): Promise<void> {
  const script = `
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(${JSON.stringify(db)});
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('probe', 'held')").run();
    process.stdout.write("locked\\n");
    setTimeout(() => { db.exec("COMMIT"); process.stdout.write("released\\n"); }, ${ms});`;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((resolve) => {
    child.stdout.on("data", (chunk: Buffer) => {
      if (String(chunk).includes("locked")) resolve();
    });
  });
}

async function round(name: string, hold: number): Promise<void> {
  const common = join(scratch, name, ".git");
  mkdirSync(common, { recursive: true });
  const created = openCodeStore(common, ON);
  if (isCodeStoreOpenFailure(created)) throw new Error(JSON.stringify(created));
  created.close();
  const t0 = Date.now();
  const at = () => `${((Date.now() - t0) / 1000).toFixed(2)} s`;
  const logs: string[] = [];
  const stored: string[] = [];
  if (hold > 0) await holdLock(join(common, "squeal", "code.sqlite"), hold);
  const writer = createCoverageWriter({
    commonDir: common,
    format: "sha1",
    policy: () => ON,
    resultKey: (_run, testFile) => `key-${testFile.path}`,
    log: (text) => logs.push(`${at()} ${text}`),
    onStored: () => stored.push(at()),
  });
  const dir = join(scratch, name);
  const files = Array.from({ length: FILES }, (_, i) => payloadFile(dir, `t${String(i).padStart(2, "0")}.test.js`));
  writer.collected({ runId: "run-1", files });
  await writer.idle();
  await writer.close();
  const store = openCodeStore(common, ON);
  if (isCodeStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  const line = files
    .map((f) =>
      store.coverage.has({ resultKey: `key-${f.testFile.path}`, providerVersion: COVERAGE_PROVIDER_VERSION })
        ? "."
        : "X",
    )
    .join("");
  store.close();
  console.log(`== ${name}: lock held ${hold} ms; records by queue position: ${line} (X = none)`);
  console.log(`   stored at: ${stored.join(", ")}; writer idle at ${at()}`);
  for (const log of logs) console.log(`   log ${log}`);
}

try {
  await round("held", holdMs);
  await round("control", 0);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
