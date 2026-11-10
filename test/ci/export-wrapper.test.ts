import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decodeBundle } from "../../src/core/store/transfer-bundle.js";
import { ci, committed, scratchDir, VITEST, writeFiles } from "./fixture.js";

/*
 * Review of 0.1.421, second round, B1 (spec 018 D8, D9 as amended
 * 2026-11-09, "one owner for input evidence"): a command that changes an
 * input around its Vitest run. A Node wrapper outside the fixture runs the
 * project's Vitest and, per mode, writes `BAD` after it (A), writes `GOOD`
 * into a committed module before it and restores it after (B), or creates
 * a module before it and removes it after (C). Each recorded test passes;
 * at the content the wrapper leaves, it fails. The export of those parts at
 * that content holds no result of it, and still holds the file the wrapper
 * did not touch. The wrapper changes the files itself, where the evidence
 * sees the writes, or through `sh`, where only the content the run read
 * tells them apart. In D (repair R3) the test itself reads `GOOD`, has `sh`
 * write `BAD`, and reads again in the same turn: the path had two contents
 * in the run, so it has no evidence. In E and F (row 018-23, review of
 * 0.1.421 r3, B1) the test opens the file read-only at `BAD!`, marks that it
 * is ready, and reads through the open descriptor (E) or file handle (F)
 * until it sees `GOOD`, which the wrapper writes when it sees the mark and
 * replaces with `BAD!` after the run. In G (review of 0.1.424, B1) the test
 * opens a file handle and reads through its numeric descriptor.
 */

const SLOW = { timeout: 300_000 };

const WRAPPER = `import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
const [mode, writer, vitest] = process.argv.slice(2);
const sh = (script, ...args) => spawnSync("sh", ["-c", script, "sh", ...args], { stdio: "inherit" });
const put = (file, text) => (writer === "sh" ? sh('printf "%s" "$1" > "$2"', text, file) : writeFileSync(file, text));
const remove = (file) => (writer === "sh" ? sh('rm "$1"', file) : rmSync(file));
if (mode === "E" || mode === "F" || mode === "G") {
  const run = spawn(process.execPath, [vitest, "run"], { env: process.env, stdio: "inherit" });
  const ready = setInterval(() => {
    if (!existsSync("data/ready")) return;
    clearInterval(ready);
    put("data/value.txt", "GOOD");
  }, 5);
  run.on("exit", (code) => {
    clearInterval(ready);
    put("data/value.txt", "BAD!");
    process.exitCode = code ?? 1;
  });
} else {
  if (mode === "B") put("src/value.ts", 'export const value = "GOOD";');
  if (mode === "C") put("src/generated.ts", 'export const value = "GOOD";');
  const run = spawnSync(process.execPath, [vitest, "run"], { env: process.env, stdio: "inherit" });
  if (mode === "A") put("data/value.txt", "BAD");
  if (mode === "B") put("src/value.ts", 'export const value = "BAD";\\n');
  if (mode === "C") remove("src/generated.ts");
  process.exitCode = run.status ?? 1;
}
`;

/** A test that opens the input read-only and reads through it, by `read`, until it holds `GOOD`. */
const THROUGH = (
  opening: string,
  read: string,
) => `import { openSync, readSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { expect, it } from "vitest";
const file = new URL("../data/value.txt", import.meta.url);
it("input", async () => {
  ${opening}
  const bytes = Buffer.alloc(4);
  ${read}
  expect(bytes.toString()).toBe("BAD!");
  writeFileSync(new URL("../data/ready", import.meta.url), "");
  for (const until = Date.now() + 1500; bytes.toString() !== "GOOD" && Date.now() < until; ) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    ${read}
  }
  expect(bytes.toString()).toBe("GOOD");
});
it("other", () => {});
`;

const IMPORTS = (from: string) =>
  `import { expect, it } from "vitest";\nimport { value } from "${from}";\nit("input", () => expect(value).toBe("GOOD"));\nit("other", () => {});\n`;

const FILES = {
  "package.json": JSON.stringify({ name: "ci-wrapper-fixture", private: true, type: "module" }),
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/*.test.ts"], maxWorkers: 1 } });\n`,
  ".gitignore": "data/\nnode_modules/\n",
  "src/value.ts": 'export const value = "BAD";\n',
  "test/plain.test.ts": `import { expect, it } from "vitest";\nit("plain", () => expect(1 + 1).toBe(2));\n`,
};

/** Per mode, the test file the wrapper's change decides and its content. */
const CHANGED = {
  A: [
    "test/read.test.ts",
    `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\nit("input", () => expect(readFileSync(new URL("../data/value.txt", import.meta.url), "utf8")).toBe("GOOD"));\nit("other", () => {});\n`,
  ],
  B: ["test/module.test.ts", IMPORTS("../src/value.js")],
  C: ["test/generated.test.ts", IMPORTS("../src/generated.js")],
  D: [
    "test/reread.test.ts",
    `import { spawnSync } from "node:child_process";\nimport { readFileSync } from "node:fs";\nimport { fileURLToPath } from "node:url";\nimport { expect, it } from "vitest";\nconst file = new URL("../data/value.txt", import.meta.url);\nit("input", () => {\n  const first = readFileSync(file, "utf8");\n  spawnSync("sh", ["-c", 'printf BAD > "$1"', "sh", fileURLToPath(file)]);\n  readFileSync(file, "utf8");\n  expect(first).toBe("GOOD");\n});\nit("other", () => {});\n`,
  ],
  E: [
    "test/descriptor.test.ts",
    THROUGH(`const fd = openSync(file, "r");`, "readSync(fd, bytes, 0, 4, 0);"),
  ],
  F: [
    "test/handle.test.ts",
    THROUGH(`const handle = await open(file, "r");`, "await handle.read(bytes, 0, 4, 0);"),
  ],
  G: [
    "test/handle-fd.test.ts",
    THROUGH(`const handle = await open(file, "r");`, "readSync(handle.fd, bytes, 0, 4, 0);"),
  ],
} as const;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Records the fixture through the wrapper in `mode`, then exports the parts where it left the content. */
async function wrapped(mode: keyof typeof CHANGED, writer: "node" | "sh") {
  const dir = scratchDir(`ci-wrapper-${mode}-${writer}`);
  dirs.push(dir);
  const [changed, test] = CHANGED[mode];
  const root = committed(dir, { ...FILES, [changed]: test });
  if (mode === "A" || mode === "D") writeFiles(root, { "data/value.txt": "GOOD" });
  if (mode === "E" || mode === "F" || mode === "G") writeFiles(root, { "data/value.txt": "BAD!" });
  const wrapper = join(dir, "wrapper.mjs");
  writeFileSync(wrapper, WRAPPER);
  const out = join(dir, "parts");
  const env = { ...process.env, CI: "true" };
  const command = [process.execPath, wrapper, mode, writer, VITEST];
  const recorded = await ci(["record", "--out", out, "--", ...command], root, env);
  const target = join(dir, "results.json.gz");
  const exported = await ci(["export", "--parts", out, "--out", target], root);
  const bundle = existsSync(target) ? decodeBundle(readFileSync(target)) : null;
  if (typeof bundle === "string") throw new Error(bundle);
  return { root, changed, recorded, exported, bundle };
}

/** Plain Vitest at `root`'s content now, on `file`: its exit code. */
function independently(root: string, file: string): number | null {
  const run = spawnSync(process.execPath, [VITEST, "run", file], {
    cwd: root,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
  });
  return run.status;
}

describe("ci export takes no evidence from a command's endpoints (review of 0.1.421 r2, B1)", () => {
  it.each([
    ["A", "node", "a hash taken after the run"],
    ["B", "node", "a clean checkout before and after the run"],
    ["C", "node", "absence before and after the run"],
    ["A", "sh", "a hash taken after the run"],
    ["B", "sh", "a clean checkout before and after the run"],
    ["C", "sh", "absence before and after the run"],
    ["D", "sh", "the last of two contents read in one turn"],
    ["E", "sh", "the hash of a read-only open read through later"],
    ["F", "sh", "the hash of a read-only file handle read through later"],
    ["G", "sh", "the hash of a file handle read through its numeric descriptor"],
  ] as const)("%s, written by %s: no result certified by %s", SLOW, async (mode, writer, _what) => {
    const { root, changed, recorded, exported, bundle } = await wrapped(mode, writer);
    expect(recorded.code, recorded.said).toBe(0);
    expect(exported.code, exported.said).toBe(0);
    const paths = bundle?.testFiles.map((file) => file.path) ?? [];
    expect(paths, exported.said).not.toContain(changed);
    expect(exported.said).toContain(`left out ${changed}: its shard recorded other content`);
    expect(bundle?.results.some((result) => result.testPath === changed)).toBe(false);
    // The file the wrapper did not touch is still proven by what the run read.
    expect(paths, exported.said).toContain("test/plain.test.ts");
    expect(independently(root, changed)).toBe(1);
  });
});
