import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { alive, beats, PREPARE_SCRIPT, pidsOf } from "../code/gate/prepare-cancel-kit.js";
import { edit, repo } from "./code-gate-fixture.js";

/*
 * Review 0.1.432 B1 (spec 020 D15.3, D3.4): cancelling `squeal code --base`
 * while a node:test entry's `prepare` runs ends that command and its
 * ordinary descendant before the CLI exits, so nothing writes after it.
 * With `--json` the gate runs in a child of the CLI process (D14.4), and
 * the signal reaches it forwarded; without it, the CLI process runs the
 * gate. The real CLI entry runs through tsx, as `code-gate-json-stdout`'s.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const CLI = resolve(import.meta.dirname, "../../src/cli/index.ts");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const own = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

/** A node:test entry whose base declares the endless `prepare`, and a head that edits its test. */
function project(): string {
  const root = repo({
    "package.json": `${JSON.stringify({ name: "gate-cancel", private: true, type: "module" })}\n`,
    "squeal.config.json": `${JSON.stringify({
      nodeTest: [
        {
          name: "node",
          include: ["test/*.test.mjs"],
          prepare: { command: [process.execPath, "prepare.cjs"], timeoutSeconds: 120 },
        },
      ],
    })}\n`,
    "prepare.cjs": PREPARE_SCRIPT,
    "test/a.test.mjs": 'import test from "node:test";\n\ntest("passes", () => 1);\n',
  });
  edit(root, { "test/a.test.mjs": 'import test from "node:test";\n\ntest("passes", () => 2);\n' });
  return root;
}

/** The CLI at `root` with `args`, given `signal` once the `prepare` command and its descendant run. */
async function cancelled(root: string, args: readonly string[], signal: NodeJS.Signals) {
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: own("squeal-gate-home-"),
    TMPDIR: own("squeal-gate-tmp-"),
  };
  const flags = ["--disable-warning=ExperimentalWarning", "--import", TSX, CLI];
  const child = spawn(process.execPath, [...flags, "code", "--base", "main", ...args], {
    cwd: root,
    env,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (text: string) => {
    stdout += text;
  });
  child.stderr.setEncoding("utf8").on("data", (text: string) => {
    stderr += text;
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
    child.on("close", (code, ended) => done({ code, signal: ended }));
  });
  const pids = await pidsOf(root, 90_000);
  child.kill(signal);
  const ended = await closed;
  // At the CLI's exit: which of them still runs, and what they wrote so far.
  const running = [pids.prepare, pids.child].filter(alive);
  const wrote = beats(root);
  await delay(500);
  return { ...ended, stdout, stderr, running, wrote, wroteLater: beats(root) };
}

describe("squeal code --base cancelled during a node:test entry's prepare (review 0.1.432 B1)", () => {
  // The CLI compiles through tsx in each process; a loaded host needs headroom.
  it("with --json, on SIGTERM: the command and its descendant end first, and stdout stays empty", {
    timeout: 180_000,
  }, async () => {
    const ran = await cancelled(project(), ["--json"], "SIGTERM");

    expect(ran.stderr).toContain('squeal code: node:test entry "node": prepare: ');
    expect(ran.stderr).toContain(
      "squeal code: the gate's process ended on SIGTERM without a whole report, so stdout stays empty\n",
    );
    expect(ran.stdout).toBe("");
    expect(ran.code).toBe(3);
    expect(ran.running).toEqual([]);
    expect(ran.wroteLater).toEqual(ran.wrote);
  });

  it("without --json, on SIGINT: the command and its descendant end first, then the CLI ends on SIGINT", {
    timeout: 180_000,
  }, async () => {
    const ran = await cancelled(project(), [], "SIGINT");

    expect(ran.stderr).toContain('squeal code: node:test entry "node": prepare: ');
    expect(ran.stdout).toBe("");
    expect(ran).toMatchObject({ code: null, signal: "SIGINT" });
    expect(ran.running).toEqual([]);
    expect(ran.wroteLater).toEqual(ran.wrote);
  });
});
