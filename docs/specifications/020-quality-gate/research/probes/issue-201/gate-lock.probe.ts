import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GateReport } from "../../../../../../src/core/code/gate/report.js";
import { lockHolders } from "../../../../../../src/core/store/lock-holders.js";
import { isStoreOpenFailure, openStore } from "../../../../../../src/core/store/open.js";
import { storePaths } from "../../../../../../src/core/store/paths.js";
import { code, ownHomeAndTmp } from "../../../../../../test/cli/code-gate-fixture.js";
import { initRepo, writeFile } from "../../../../../../test/hash/git-repo.js";

/* Throwaway probe for issue #201. Prints evidence; asserts only the verdict. */

const FILES = ["a", "b", "c", "d", "e"].map((n) => `test/${n}.test.mjs`);
const testOf = (title: string) =>
  `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { double } from "../src/math.mjs";\n\ntest(${JSON.stringify(title)}, () => assert.equal(double(2), 4));\n`;

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "issue-201-"));
  initRepo(root, {
    "package.json": `${JSON.stringify({ name: "issue-201", private: true, type: "module" })}\n`,
    "squeal.config.json": `${JSON.stringify({
      complexity: { enabled: true },
      coverage: { enabled: true },
      nodeTest: [{ name: "t", include: ["test/*.test.mjs"] }],
    })}\n`,
    "src/math.mjs": "export function double(x) {\n  return x * 2;\n}\n",
    ...Object.fromEntries(FILES.map((f) => [f, testOf(f)])),
  });
  writeFile(root, "src/math.mjs", "export function double(x) {\n  return x + x;\n}\n");
  return root;
}

/** Creates the scratch store as the gate would, then closes it. */
function createStore(root: string): string {
  const commonDir = join(root, ".git");
  const store = openStore(commonDir);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  store.close();
  return storePaths(commonDir).database;
}

/** A child process that holds `database`'s write lock until `release`. */
async function holder(database: string): Promise<{ child: ChildProcess; release: () => void }> {
  const script = `const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
db.exec("BEGIN IMMEDIATE");
process.stdout.write("held\\n");
process.stdin.on("data", () => { db.exec("ROLLBACK"); db.close(); process.exit(0); });`;
  const child = spawn(process.execPath, ["-e", script, database], { stdio: ["pipe", "pipe", "inherit"] });
  await new Promise<void>((done) => child.stdout?.once("data", () => done()));
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    child.stdin?.write("x");
  };
  return { child, release };
}

async function gate(root: string, onStderr?: (text: string) => void) {
  const started = Date.now();
  let reportAtMs: number | null = null;
  const ran = await code(root, ["--base", "main", "--json"], {
    stderr: onStderr,
    stdout: (text) => { if (text.includes('"verdict"')) reportAtMs = Date.now() - started; },
  });
  const report = JSON.parse(ran.stdout) as GateReport;
  const run = report.runs[0];
  return {
    exit: ran.code,
    ms: Date.now() - started,
    reportAtMs,
    verdict: report.verdict,
    counts: report.counts,
    from: run?.from,
    stderr: ran.stderr,
  };
}

const roots: string[] = [];
const holders: { child: ChildProcess; release: () => void }[] = [];
afterEach(() => {
  for (const h of holders.splice(0)) h.release();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function log(label: string, value: unknown) {
  const out = process.env.ISSUE201_OUT;
  const line = `[issue-201] ${label}: ${JSON.stringify(value, null, 1)}\n`;
  if (out) appendFileSync(out, line);
  else process.stderr.write(line);
}

describe("issue #201 probe", () => {
  it("control: no lock", async () => {
    ownHomeAndTmp();
    const root = fixture();
    roots.push(root);
    const first = await gate(root);
    log("control first", first);
    const second = await gate(root);
    log("control second", second);
    expect(Object.values(second.from ?? {})).toEqual(Array(5).fill("store"));
    expect(first.verdict).toBe("pass");
    expect(first.exit).toBe(0);
  });

  it("held: a child process holds the write lock through the whole gate", async () => {
    ownHomeAndTmp();
    const root = fixture();
    roots.push(root);
    const database = createStore(root);
    const h = await holder(database);
    holders.push(h);
    log("holders while held (parent pid " + process.pid + ", child pid " + h.child.pid + ")", lockHolders(database));
    const first = await gate(root);
    log("held first", first);
    h.release();
    await new Promise((done) => h.child.once("exit", done));
    const second = await gate(root);
    log("held second (lock free)", second);
    expect(first.stderr).toContain("5 completed test files were not kept");
    expect(first.ms - (first.reportAtMs ?? first.ms)).toBeGreaterThan(29_000);
    expect(Object.keys(second.from ?? {})).toHaveLength(0);
    expect(first.verdict).toBe("pass");
    expect(first.exit).toBe(0);
  });

  it("short: the child frees the lock 3 s after the gate starts its run", async () => {
    ownHomeAndTmp();
    const root = fixture();
    roots.push(root);
    const database = createStore(root);
    const h = await holder(database);
    holders.push(h);
    let releasedAt = 0;
    const started = Date.now();
    const first = await gate(root, (text) => {
      if (releasedAt === 0 && text.includes("to run")) {
        releasedAt = -1;
        setTimeout(() => {
          releasedAt = Date.now() - started;
          h.release();
        }, 3_000);
      }
    });
    log("short first", { ...first, releasedAtMs: releasedAt });
    const second = await gate(root);
    log("short second", second);
    expect(Object.values(second.from ?? {})).toEqual(Array(5).fill("store"));
    expect(first.verdict).toBe("pass");
    expect(first.exit).toBe(0);
  });
});
