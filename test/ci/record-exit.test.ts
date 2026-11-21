import { execFileSync, spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { type Part, readPart } from "../../src/core/ci/parts.js";
import {
  nodeTestCommand,
  project,
  reporterPair,
  temp,
} from "../runners/node-test/ci-record-kit.js";

/*
 * Row 018-67 (review 0.1.585 S1, spec 018 D30, D20.2): past the endpoint
 * hashing's limit, a file read the operating system never ends does not
 * hold the `squeal ci record` process open. The process exits with the
 * command's code soon after the limit, and writes its part without
 * endpoint hashes. Without the stall, the hashes are in the part as before.
 * Each run is a real process; `ciCommand`'s return alone would not show it.
 */

const SLOW = { timeout: 120_000 } as const;
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const STALL = pathToFileURL(resolve(import.meta.dirname, "stall-read.mjs")).href;
const ENTRY = resolve(import.meta.dirname, "record-exit-entry.ts");
const CLI = resolve(import.meta.dirname, "../../src/cli/index.ts");

const FILES = {
  "stall.txt": "a file whose read never ends\n",
  "test/one.test.mjs":
    'import { test } from "node:test";\ntest("fails", () => { throw new Error("x"); });\n',
  "squeal.config.json": `${JSON.stringify({ nodeTest: [{ name: "unit", include: ["test/*.test.mjs"] }] })}\n`,
};

interface Ran {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly ms: number;
  readonly stderr: string;
  readonly parts: Part[];
}

/** `script ci record --out <dir> -- <command>` in `root`, killed after `killMs`. */
function run(script: string, root: string, env: NodeJS.ProcessEnv, killMs: number): Promise<Ran> {
  const out = join(temp(), "parts");
  const command = nodeTestCommand(process.execPath, [...reporterPair(), "test/one.test.mjs"]);
  // The entry takes `ciCommand`'s arguments; the CLI takes the command's name first.
  const ci = script === ENTRY ? [] : ["ci"];
  const args = ["--import", TSX, script, ...ci, "record", "--out", out, "--", ...command];
  const begin = performance.now();
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const kill = setTimeout(() => child.kill("SIGKILL"), killMs);
  return new Promise((done) => {
    child.once("exit", (code, signal) => {
      clearTimeout(kill);
      const ms = performance.now() - begin;
      const names = (() => {
        try {
          return readdirSync(out).sort();
        } catch {
          return [];
        }
      })();
      const parts = names.map((name) => {
        const part = readPart(join(out, name));
        if (typeof part === "string") throw new Error(part);
        return part;
      });
      done({ code, signal, ms, stderr, parts });
    });
  });
}

describe("ci record's process past the endpoint hashing's limit", () => {
  it(
    "exits with the command's code soon after the limit while a read never ends",
    SLOW,
    async () => {
      const root = project(FILES);
      const fifo = join(temp(), "fifo");
      execFileSync("mkfifo", [fifo]);
      const env = {
        ...process.env,
        NODE_OPTIONS: `--import ${STALL}`,
        SQUEAL_TEST_STALL_FIFO: fifo,
        SQUEAL_TEST_HASHING_FLOOR_MS: "3000",
      };
      const ran = await run(ENTRY, root, env, 30_000);
      expect(ran.signal, ran.stderr).toBeNull();
      // node --test's code for a failing test, not Squeal's (D20.2).
      expect(ran.code, ran.stderr).toBe(1);
      expect(ran.stderr).toMatch(
        /no endpoint hashes: hashing the checkout passed its limit of 3\.0 s \(\d+ of \d+ paths\)/,
      );
      const [part] = ran.parts;
      expect(part?.header.runner).toBe("node-test");
      expect(part?.stable).toBeUndefined();
      // The limit, the command and the part: well inside the 30 s the stalled read would hold it.
      expect(ran.ms).toBeLessThan(20_000);
    },
  );

  it(
    "keeps the endpoint hashes in its part without a stall, through the CLI's own entry",
    SLOW,
    async () => {
      const root = project(FILES);
      const ran = await run(CLI, root, process.env, 60_000);
      expect(ran.code, ran.stderr).toBe(1);
      expect(ran.stderr).not.toMatch(/no endpoint hashes/);
      const [part] = ran.parts;
      expect(part?.header.runner).toBe("node-test");
      expect(part?.stable?.["./"]).toEqual(expect.any(String));
    },
  );
});
