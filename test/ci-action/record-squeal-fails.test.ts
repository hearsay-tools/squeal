import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ciCommand } from "../../src/cli/ci.js";
import type { CliIo } from "../../src/cli/main.js";

/*
 * Spec 018 D20.2, row 018-33 item 2: when Squeal itself fails inside
 * `squeal ci record`, the command's own exit code still decides the step.
 * The fixture lives inside the repository, so `vitest` resolves from the
 * repository's `node_modules` and `record` gets as far as starting its
 * recording.
 */

const REPO = resolve(import.meta.dirname, "../..");
const VITEST = join(REPO, "node_modules/vitest/vitest.mjs");
const SCRATCH = join(REPO, "test/fixtures/vitest/.tmp");
const SLOW = { timeout: 180_000 } as const;

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A git repository with one passing Vitest file. */
function fixture(): string {
  const root = join(SCRATCH, `record-fails-${randomUUID()}`);
  made.push(root);
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, type: "module" }));
  writeFileSync(
    join(root, "vitest.config.ts"),
    `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
  );
  writeFileSync(
    join(root, "test/a.test.ts"),
    `import { expect, it } from "vitest";\nit("passes", () => expect(1).toBe(1));\n`,
  );
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "f"], {
    cwd: root,
  });
  return root;
}

async function record(root: string, args: readonly string[], tempDir?: string) {
  let text = "";
  const add = (chunk: string) => {
    text += chunk;
  };
  const io: CliIo = { stdout: add, stderr: add, cwd: root, env: process.env };
  const deps = tempDir === undefined ? {} : { tempDir };
  const exit = await ciCommand(["record", ...args], io, deps);
  return { exit, text };
}

describe("squeal ci record when Squeal's own recording fails", () => {
  it("before the command: runs it unchanged and exits with its code", async () => {
    const root = fixture();
    const marker = join(root, "ran");
    const missing = join(root, "no-such-dir", "temp");
    const run = await record(
      root,
      ["--", "/bin/sh", "-c", `echo ran > '${marker}'; exit 3`],
      missing,
    );
    expect(run.exit).toBe(3);
    expect(readFileSync(marker, "utf8")).toBe("ran\n");
    expect(run.text).toMatch(
      /squeal ci record: Squeal could not start recording \(.*ENOENT.*\); the command runs unchanged, nothing recorded\n/,
    );
  });

  it("after the command: a part it cannot write keeps the command's code", SLOW, async () => {
    const root = fixture();
    // `--out` names a file, so the part's directory cannot be made.
    const out = join(root, "parts-is-a-file");
    writeFileSync(out, "");
    const run = await record(root, ["--out", out, "--", process.execPath, VITEST, "run"]);
    expect(run.exit).toBe(0);
    expect(run.text).toMatch(/squeal ci record: no part written: .*(EEXIST|ENOTDIR)/);
  });
});
