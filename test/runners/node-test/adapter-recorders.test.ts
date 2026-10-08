import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { NodeTestProject } from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";

/**
 * Task 003-35: a test process under a Squeal daemon carries 001-132's
 * recorder as a `--require` in `NODE_OPTIONS`, and `SQUEAL_OBSERVE`. A
 * node:test adapter built there keys its project as one built in a plain
 * shell: the recorder is no preload, adds no package and no note, while a
 * `--require` in the project's own `env.NODE_OPTIONS` still is a preload.
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const SLOW = { timeout: 60_000 } as const;
const scratch = join(FIXTURES, ".tmp", randomUUID());
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

const RECORDERS = [
  resolve(import.meta.dirname, "../../../plugins/claude-code/dist/observe/recorder.cjs"),
  resolve(import.meta.dirname, "../../../src/runners/node-test/runtime/recorder.cjs"),
];

function repo(): string {
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify({ name: "recorders", private: true, type: "module" })}\n`,
    "scripts/setup.cjs": "globalThis.setupRan = true;\n",
    "test/a.test.mjs": `import { test } from "node:test";\ntest("a", () => {});\n`,
  };
  const dir = join(scratch, randomUUID());
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return realpathSync(dir);
}

const project = (env: Readonly<Record<string, string>> = {}): NodeTestProject => ({
  name: "p",
  node: process.execPath,
  argv: [],
  env,
  include: ["test/*.test.mjs"],
});

async function keyed(root: string, p: NodeTestProject) {
  const notes: string[] = [];
  const adapter = await createNodeTestAdapter(p, { root, note: (text) => notes.push(text) });
  const testFile = { project: "p", path: "test/a.test.mjs" };
  return {
    environment: await adapter.environment(),
    closure: await adapter.closure(testFile),
    notes,
  };
}

/** Under a daemon: Squeal's recorders inherited, quoted as 001's `observeEnv` writes them. */
function underDaemon(): void {
  vi.stubEnv("NODE_OPTIONS", RECORDERS.map((r) => `--require ${JSON.stringify(r)}`).join(" "));
  vi.stubEnv("SQUEAL_OBSERVE", JSON.stringify({ out: "/nonexistent", root: "/nonexistent" }));
}

describe("Squeal's own recorders in an inherited NODE_OPTIONS (task 003-35)", () => {
  it("key the project as a plain shell does", SLOW, async () => {
    const root = repo();
    vi.stubEnv("NODE_OPTIONS", "");
    vi.stubEnv("SQUEAL_OBSERVE", undefined);
    const plain = await keyed(root, project());
    expect(plain.environment[0]?.files).toEqual([]);

    underDaemon();
    expect(await keyed(root, project())).toEqual(plain);
  });

  it("leave a project's own --require in its env a preload", SLOW, async () => {
    const root = repo();
    underDaemon();
    const own = project({ NODE_OPTIONS: "--require ./scripts/setup.cjs" });
    const { environment, notes } = await keyed(root, own);
    expect(environment[0]?.files).toEqual(["package.json", "scripts/setup.cjs"]);
    expect(notes).toEqual([]);
  });

  it("leave an inherited --require of the project's beside them a preload", SLOW, async () => {
    const root = repo();
    underDaemon();
    vi.stubEnv("NODE_OPTIONS", `${process.env.NODE_OPTIONS} --require ./scripts/setup.cjs`);
    const { environment } = await keyed(root, project());
    expect(environment[0]?.files).toEqual(["package.json", "scripts/setup.cjs"]);
  });
});
