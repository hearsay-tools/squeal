import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach } from "vitest";
import type {
  AffectedTestFiles,
  RunnerAdapter,
  RunOptions,
  TestFileRef,
} from "../../../src/core/types/index.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { compareRefs } from "../../../src/runners/vitest/results.js";

const fixturesDir = resolve(import.meta.dirname, "../../fixtures/vitest");

/**
 * Copies inside the repository, not under the OS temp dir, so the fixture
 * resolves `vitest` from the repository's `node_modules`. `.tmp/` is
 * git-ignored and excluded from lint, typecheck and the root Vitest run.
 */
const scratchDir = join(fixturesDir, ".tmp");

/** Adapter tests spawn real Vitest instances; a loaded machine needs headroom. */
export const SLOW = { timeout: 120_000 } as const;

export interface FixtureProject {
  readonly root: string;
  readonly adapter: RunnerAdapter;
  write(path: string, content: string): void;
  read(path: string): string;
  remove(path: string): void;
  runOptions(overrides?: Partial<RunOptions>): RunOptions;
}

const open: FixtureProject[] = [];

afterEach(async () => {
  const projects = open.splice(0);
  await Promise.all(projects.map((p) => p.adapter.close()));
  for (const p of projects) rmSync(p.root, { recursive: true, force: true });
});

/**
 * Copies `test/fixtures/vitest/<name>`, writes `files` into the copy, and
 * opens an adapter on it, through `create` when given. Closed after each test.
 */
export async function openFixture(
  name = "basic",
  files: Readonly<Record<string, string>> = {},
  create: (root: string) => Promise<RunnerAdapter> = (root) => createVitestAdapter({ root }),
): Promise<FixtureProject> {
  const root = join(scratchDir, `${name}-${randomUUID()}`);
  mkdirSync(scratchDir, { recursive: true });
  cpSync(join(fixturesDir, name), root, { recursive: true });
  const at = (path: string) => join(root, path);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(at(path)), { recursive: true });
    writeFileSync(at(path), content);
  }
  try {
    const adapter = await create(root);
    const project: FixtureProject = {
      root,
      adapter,
      write(path, content) {
        mkdirSync(dirname(at(path)), { recursive: true });
        writeFileSync(at(path), content);
      },
      read: (path) => readFileSync(at(path), "utf8"),
      remove: (path) => rmSync(at(path), { force: true }),
      runOptions: (overrides) => ({
        runId: randomUUID(),
        logDir: at(".squeal-logs"),
        timeoutMs: null,
        ...overrides,
      }),
    };
    open.push(project);
    return project;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export const ref = (path: string, project = ""): TestFileRef => ({ project, path });

/** Every affected test file, direct and transitive, sorted. */
export const all = (affected: AffectedTestFiles): TestFileRef[] =>
  [...affected.direct, ...affected.transitive].sort(compareRefs);

export const paths = (refs: readonly TestFileRef[] | AffectedTestFiles) =>
  ("direct" in refs ? all(refs) : refs).map((r) => r.path);

export const ALL_TEST_FILES = [
  "test/each.test.ts",
  "test/greeting.test.ts",
  "test/math.test.ts",
  "test/strings.test.ts",
];
