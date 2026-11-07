import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownRecord } from "../../src/core/code/coverage/own.js";
import type { CoverageRecord, V8Payload } from "../../src/core/code/coverage/types.js";

/*
 * Review 0.1.415 B1: a real V8 payload, as a node:test file's own process
 * leaves it, of a module whose one function starts at line 1, column 0, as
 * the module's top level does.
 */

/** The review's exact bytes. */
export const ANSWER = "function answer() { return 42; }\nexport { answer };\n";

/**
 * The record of `src/answer.mjs` from a Node process in a temporary
 * directory, removed after, that calls `answer()` or only imports it.
 */
export function answerRecord(call: boolean): { readonly record: CoverageRecord } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sq-reach-v8-")));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "test"));
  writeFileSync(join(root, "src/answer.mjs"), ANSWER);
  // A plain Node process that imports the module as a node:test file's own process does.
  const body = call
    ? "if (answer() !== 42) process.exit(1);"
    : 'if (typeof answer !== "function") process.exit(1);';
  writeFileSync(
    join(root, "test/answer.mjs"),
    `import { answer } from "../src/answer.mjs";\n${body}\n`,
  );
  const coverage = join(root, "coverage");
  mkdirSync(coverage);
  const { NODE_OPTIONS: _options, SQUEAL_OBSERVE: _observe, ...env } = process.env;
  execFileSync(process.execPath, ["test/answer.mjs"], {
    cwd: root,
    env: { ...env, NODE_V8_COVERAGE: coverage },
    stdio: "ignore",
  });
  try {
    for (const name of readdirSync(coverage)) {
      const payload = JSON.parse(readFileSync(join(coverage, name), "utf8")) as V8Payload;
      const record = ownRecord(root, payload, "sha1");
      if (record.sources.some((s) => s.path === "src/answer.mjs")) return { record };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  throw new Error("no V8 payload names src/answer.mjs");
}
