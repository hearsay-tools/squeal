import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckId } from "../../src/core/types/check.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { SLOW } from "../scheduler/cleanup.js";
import { addWorktree, createRepo, openRepoStore } from "../scheduler/repo.js";
import { type Harness, openHarness } from "../scheduler/vitest-harness.js";

/*
 * Row 023-14, reviews/wave-4.md B1 and B2 with the real Vitest adapter: a
 * test reads `value` through a manifest chain into a workspace package
 * `@w/shared` (linked in `node_modules`) or its own package, and expects
 * "a". Changing only a manifest on the chain, while no daemon ran or in
 * another worktree, makes the import read "b": the stored pass must not be
 * reused, a run must fail, and the undo must reuse the pass with no run.
 */

const TEST = "test/chain.test.ts";
const READS_A: CheckId = { kind: "test", project: "", testPath: TEST, fullName: "reads a" };
const OWN = "squeal-fixture-scheduler-basic";

const json = (data: unknown) => `${JSON.stringify(data, null, 2)}\n`;
const value = (v: string) => `export const value = "${v}";\n`;
const shared = (extra: Record<string, unknown> = {}) =>
  json({ name: "@w/shared", private: true, type: "module", ...extra });

/** One chain: its files, the specifier the test imports, and the one manifest change that reads "b". */
interface Chain {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly specifier: string;
  readonly change: { readonly path: string; readonly text: string | null };
}

const CHAINS: readonly Chain[] = [
  {
    name: "B1: a # entry naming a workspace package whose exports is retargeted",
    files: {
      "package.json": json({
        name: OWN,
        private: true,
        type: "module",
        imports: { "#chosen": "@w/shared" },
      }),
      "packages/shared/package.json": shared({ exports: "./a.ts" }),
      "packages/shared/a.ts": value("a"),
      "packages/shared/b.ts": value("b"),
    },
    specifier: "#chosen",
    change: { path: "packages/shared/package.json", text: shared({ exports: "./b.ts" }) },
  },
  {
    name: "B2: a workspace subpath whose nested main is retargeted",
    files: {
      "packages/shared/package.json": shared(),
      "packages/shared/sub/package.json": json({ type: "module", main: "./a.ts" }),
      "packages/shared/sub/a.ts": value("a"),
      "packages/shared/sub/b.ts": value("b"),
    },
    specifier: "@w/shared/sub",
    change: {
      path: "packages/shared/sub/package.json",
      text: json({ type: "module", main: "./b.ts" }),
    },
  },
  {
    name: "B2: a workspace subpath that gains a nested manifest",
    files: {
      "packages/shared/package.json": shared(),
      "packages/shared/sub/index.ts": value("a"),
      "packages/shared/sub/b.ts": value("b"),
    },
    specifier: "@w/shared/sub",
    change: {
      path: "packages/shared/sub/package.json",
      text: json({ type: "module", main: "./b.ts" }),
    },
  },
  {
    name: "control: a workspace package whose main is retargeted",
    files: {
      "packages/shared/package.json": shared({ main: "./a.ts" }),
      "packages/shared/a.ts": value("a"),
      "packages/shared/b.ts": value("b"),
    },
    specifier: "@w/shared",
    change: { path: "packages/shared/package.json", text: shared({ main: "./b.ts" }) },
  },
  {
    name: "control: the own package by name, its exports retargeted",
    files: {
      "package.json": json({
        name: OWN,
        private: true,
        type: "module",
        exports: { "./chosen": "./src/a.ts" },
      }),
      "src/a.ts": value("a"),
      "src/b.ts": value("b"),
    },
    specifier: `${OWN}/chosen`,
    change: {
      path: "package.json",
      text: json({
        name: OWN,
        private: true,
        type: "module",
        exports: { "./chosen": "./src/b.ts" },
      }),
    },
  },
];

function write(root: string, path: string, text: string | null): void {
  const full = join(root, path);
  if (text === null) {
    rmSync(full);
    return;
  }
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

/** `node_modules/@w/shared` linked to the worktree's own package, as a workspace install makes it. */
function link(root: string): void {
  mkdirSync(join(root, "node_modules/@w"), { recursive: true });
  symlinkSync(join(root, "packages/shared"), join(root, "node_modules/@w/shared"));
}

function commit(root: string, message: string): void {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", message]);
}

/** The `basic` fixture with the chain and its test, committed. */
function chainRepo(chain: Chain) {
  const repo = createRepo();
  for (const [path, text] of Object.entries(chain.files)) write(repo.main, path, text);
  write(
    repo.main,
    TEST,
    `import { expect, it } from "vitest";\nimport { value } from "${chain.specifier}";\nit("reads a", () => expect(value).toBe("a"));\n`,
  );
  link(repo.main);
  commit(repo.main, chain.name);
  return repo;
}

async function startIn(
  root: string,
  store: ReturnType<typeof openRepoStore>,
  commonDir: string,
  runMissing = false,
): Promise<Harness> {
  const h = await openHarness(root, store, commonDir, runMissing ? { policy: RUN_MISSING } : {});
  await h.scheduler.start();
  await h.quiet();
  return h;
}

async function stop(h: Harness): Promise<void> {
  await h.scheduler.close();
  await h.runner.close();
}

const CURRENT_PASS = { outcome: "pass", validity: "current" };

describe(
  "a manifest on an import's resolution chain, in keys (row 023-14, reviews/wave-4.md)",
  SLOW,
  () => {
    it.each(CHAINS)(
      "$name: a restart reads it as stale, a run fails, the undo reuses the pass",
      async (chain) => {
        const repo = chainRepo(chain);
        const store = openRepoStore(repo.commonDir);
        const start = (runMissing = false) => startIn(repo.main, store, repo.commonDir, runMissing);
        const changed = join(repo.main, chain.change.path);
        const before = existsSync(changed) ? readFileSync(changed, "utf8") : null;
        const first = await start(true);
        expect(first.sink.stateOf(READS_A)).toMatchObject(CURRENT_PASS);
        await stop(first);

        write(repo.main, chain.change.path, chain.change.text);
        const second = await start();
        expect(second.sink.stateOf(READS_A)?.validity).toBe("stale");
        expect(second.runsOf(TEST)).toEqual([]);
        await stop(second);
        // Independent of the key: a real run at the changed chain fails.
        const third = await start(true);
        expect(third.sink.stateOf(READS_A)).toMatchObject({ outcome: "fail", validity: "current" });
        await stop(third);

        write(repo.main, chain.change.path, before);
        const fourth = await start();
        expect(fourth.sink.stateOf(READS_A)).toMatchObject(CURRENT_PASS);
        expect(fourth.runsOf(TEST)).toEqual([]);
        await stop(fourth);
      },
    );

    it.each(CHAINS)(
      "$name: a second worktree at the change does not inherit the pass; one at the same commit does",
      async (chain) => {
        const repo = chainRepo(chain);
        const store = openRepoStore(repo.commonDir);
        const first = await startIn(repo.main, store, repo.commonDir, true);
        expect(first.sink.stateOf(READS_A)).toMatchObject(CURRENT_PASS);
        await stop(first);

        const same = addWorktree(repo.main, repo.dir, "same");
        link(same);
        const control = await startIn(same, store, repo.commonDir);
        expect(control.sink.stateOf(READS_A)).toMatchObject(CURRENT_PASS);
        expect(control.runsOf(TEST)).toEqual([]);
        await stop(control);

        const other = addWorktree(repo.main, repo.dir, "other");
        link(other);
        write(other, chain.change.path, chain.change.text);
        commit(other, "change the chain");
        const second = await startIn(other, store, repo.commonDir);
        // No state at all: the stored pass is not at this worktree's key, and lookup-only runs nothing.
        expect(second.sink.stateOf(READS_A)).toBeNull();
        await stop(second);
      },
    );
  },
);
