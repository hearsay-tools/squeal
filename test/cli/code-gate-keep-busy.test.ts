import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REPORT_FD_VARIABLE, unframe } from "../../src/cli/code-gate-relaunch.js";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import { initRepo, writeFile } from "../hash/git-repo.js";
import { code, ownHomeAndTmp } from "./code-gate-fixture.js";

/*
 * Spec 020 D17.5 (row 020-28, #192): `squeal code --base` writes the files
 * it completed after its report, so a store whose write lock another
 * process holds never delays the report or changes the verdict. It waits
 * up to 30 s from the first busy write, names the holder first, and on
 * exhaustion says how many files were not kept and that the next run runs
 * them again. Six node:test files: five load `src/math.mjs`, one loads
 * `src/other.mjs`; the working tree edits both. The holder is a second
 * process, as in `research/issue-192.md`.
 */

const SLOW = { timeout: 120_000 } as const;

const MATH = ["a", "b", "c", "d", "e"].map((n) => `test/${n}.test.mjs`);
const OTHER = "test/z.test.mjs";

const testOf = (from: string, name: string) =>
  `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { ${name} } from "../src/${from}.mjs";\n\ntest(${JSON.stringify(name)}, () => assert.equal(${name}(2), 4));\n`;

const OTHER_RAN = "export function square(x) {\n  return x ** 2;\n}\n";

/** The fixture repository, its working tree edited against `main`. */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "squeal-keep-busy-"));
  initRepo(root, {
    "package.json": `${JSON.stringify({ name: "keep-busy", private: true, type: "module" })}\n`,
    "squeal.config.json": `${JSON.stringify({
      complexity: { enabled: true },
      coverage: { enabled: true },
      nodeTest: [{ name: "t", include: ["test/*.test.mjs"] }],
    })}\n`,
    "src/math.mjs": "export function double(x) {\n  return x * 2;\n}\n",
    "src/other.mjs": "export function square(x) {\n  return x * x;\n}\n",
    ...Object.fromEntries(MATH.map((f) => [f, testOf("math", "double")])),
    [OTHER]: testOf("other", "square"),
  });
  writeFile(root, "src/math.mjs", "export function double(x) {\n  return x + x;\n}\n");
  writeFile(root, "src/other.mjs", OTHER_RAN);
  return root;
}

const holders: ChildProcess[] = [];
const restores: (() => void)[] = [];
afterEach(() => {
  for (const child of holders.splice(0)) child.kill("SIGKILL");
  for (const restore of restores.splice(0)) restore();
  delete process.env[REPORT_FD_VARIABLE];
});

/** A second process that holds the store's write lock until `release`. */
async function holder(root: string): Promise<{ readonly pid: number; release(): void }> {
  const commonDir = join(root, ".git");
  const store = openStore(commonDir);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  store.close();
  const script = `const db = new (require("node:sqlite").DatabaseSync)(process.argv[1]); db.exec("BEGIN IMMEDIATE"); process.stdout.write("held\\n"); process.stdin.on("data", () => { db.exec("ROLLBACK"); db.close(); process.exit(0); });`;
  const database = storePaths(commonDir).database;
  const child = spawn(process.execPath, ["-e", script, database], { stdio: "pipe" });
  holders.push(child);
  await new Promise<void>((done) => child.stdout.once("data", () => done()));
  return { pid: child.pid as number, release: () => child.stdin.write("x") };
}

interface Gate {
  readonly code: number;
  readonly report: GateReport | null;
  readonly stdout: string;
  readonly stderr: string;
  /** "report" when stdout was written, "wait" when the busy note came, in order. */
  readonly order: readonly string[];
}

/** `squeal code --base main [--json]` in `root`; `onWait` runs at the busy note. */
async function gate(root: string, json: boolean, onWait = () => {}): Promise<Gate> {
  const order: string[] = [];
  const args = ["--base", "main", ...(json ? ["--json"] : [])];
  const ran = await code(root, args, {
    stdout: () => order.push("report"),
    stderr: (text) => {
      if (!text.includes("the store is busy")) return;
      order.push("wait");
      onWait();
    },
  });
  const report = json && ran.stdout !== "" ? (JSON.parse(ran.stdout) as GateReport) : null;
  return { code: ran.code, report, stdout: ran.stdout, stderr: ran.stderr, order };
}

/** The selected files the report read from the stores, sorted. */
const fromStores = (gate: Gate) =>
  (gate.report?.runs ?? [])
    .flatMap((run) => Object.entries(run.from ?? {}))
    .filter(([, from]) => from === "store")
    .map(([path]) => path)
    .sort();

const ALL = [...MATH, OTHER];

const NAMED =
  "test/a.test.mjs, test/b.test.mjs, test/c.test.mjs, test/d.test.mjs, test/e.test.mjs and 1 more";
const busy = (pid: number) => `the store is busy (held by pid ${pid} (node -e `;

describe("squeal code --base keeps its files after the report when the store is busy (D17.5)", () => {
  it(
    "with no lock keeps every file, with no busy note, and the next run reads them",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = fixture();

      const first = await gate(root, true);
      const second = await gate(root, true);

      expect([first.code, first.report?.verdict]).toEqual([0, "pass"]);
      expect(first.stderr).not.toMatch(/store is busy|not kept/);
      expect([second.code, second.report?.verdict, fromStores(second)]).toEqual([0, "pass", ALL]);
      expect(second.stderr).toContain("6 of 6 selected test files read from the stores");
    },
  );

  it(
    "prints the report, then waits for a lock freed within the bound and keeps every file",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = fixture();
      const held = await holder(root);

      const first = await gate(root, true, () => held.release());
      const second = await gate(root, true);

      expect([first.code, first.report?.verdict]).toEqual([0, "pass"]);
      expect(first.order).toEqual(["report", "wait"]);
      expect(first.stderr).toContain(`${busy(held.pid)}`);
      expect(first.stderr).toContain(
        `waiting up to 30 s to keep 6 completed test files: ${NAMED}\n`,
      );
      expect(first.stderr).toMatch(
        /the store was free after [\d.]+ s: 6 completed test files kept\n/,
      );
      expect(first.stderr).not.toContain("not kept");
      expect([second.code, second.report?.verdict, fromStores(second)]).toEqual([0, "pass", ALL]);
    },
  );

  it("prints the plain report before the wait too", SLOW, async () => {
    ownHomeAndTmp();
    const root = fixture();
    const held = await holder(root);

    const first = await gate(root, false, () => held.release());

    expect(first.code).toBe(0);
    expect(first.order).toEqual(["report", "wait"]);
    expect(first.stdout).toMatch(/^Code gate: pass\./);
  });

  it("names the holder and the files to run again once the bound runs out", SLOW, async () => {
    ownHomeAndTmp();
    const root = fixture();
    const held = await holder(root);
    // The bound counts on `Date.now`: at the busy note, 30 s pass at once.
    const real = Date.now.bind(Date);
    let skipped = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => real() + skipped);
    restores.push(() => clock.mockRestore());

    const first = await gate(root, true, () => {
      skipped = 30_000;
    });
    clock.mockRestore();
    held.release();
    const second = await gate(root, true);

    expect([first.code, first.report?.verdict]).toEqual([0, "pass"]);
    expect(first.order).toEqual(["report", "wait"]);
    const notKept = first.stderr.split("\n").filter((line) => line.includes("not kept"));
    expect(notKept).toHaveLength(1);
    expect(notKept[0]).toMatch(
      new RegExp(
        `^squeal code: 6 completed test files were not kept in the stores: the store stayed busy for 30 s \\(held by pid ${held.pid} \\(node -e .*\\)\\); the next run will run them again$`,
      ),
    );
    expect([second.code, second.report?.verdict, fromStores(second)]).toEqual([0, "pass", []]);
    expect(second.stderr).not.toContain("read from the stores");
  });

  it("does not keep a file whose input changed after its run, before the write", SLOW, async () => {
    ownHomeAndTmp();
    const root = fixture();
    let edited = false;
    const first = await code(root, ["--base", "main", "--json"], {
      stdout: () => {
        // After the report, before the write: `z`'s input moves.
        writeFile(root, "src/other.mjs", "export function square(x) {\n  return x * x * 1;\n}\n");
        edited = true;
      },
    });
    // The bytes `z` ran with again: its key is the one the first run had.
    writeFile(root, "src/other.mjs", OTHER_RAN);
    const second = await gate(root, true);

    expect([edited, first.code]).toEqual([true, 0]);
    expect(first.stderr).not.toContain("not kept");
    expect(fromStores(second)).toEqual(MATH);
  });

  it(
    "does not keep a file whose input changed during the busy wait (review 0.1.444 B2)",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = fixture();
      const held = await holder(root);

      const first = await gate(root, true, () => {
        // After the report and the check that opens the write: `z`'s input moves.
        writeFile(root, "src/other.mjs", "export function square(x) {\n  return 9;\n}\n");
        held.release();
      });
      // The bytes `z` ran with again: its key is the one the first run had.
      writeFile(root, "src/other.mjs", OTHER_RAN);
      const second = await gate(root, true);

      expect([first.code, first.report?.verdict, first.order]).toEqual([
        0,
        "pass",
        ["report", "wait"],
      ]);
      expect(first.stderr).toMatch(
        /the store was free after [\d.]+ s: 5 completed test files kept; 1 changed during the wait, so the next run will run it again\n/,
      );
      expect([second.code, fromStores(second)]).toEqual([0, MATH]);
      expect(second.stderr).toContain("5 of 6 selected test files read from the stores");
    },
  );

  it("in the CLI's child, sends the report on its pipe before the wait", SLOW, async () => {
    ownHomeAndTmp();
    const root = fixture();
    const held = await holder(root);
    const file = join(tmpdir(), "report");
    process.env[REPORT_FD_VARIABLE] = String(openSync(file, "w"));
    let sent: string | null = null;

    const first = await gate(root, true, () => {
      sent = unframe(readFileSync(file));
      held.release();
    });

    expect([first.code, first.stdout, first.order]).toEqual([0, "", ["wait"]]);
    expect((JSON.parse(sent ?? "null") as GateReport | null)?.verdict).toBe("pass");
  });
});
