import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { globListingsMetaKey } from "../../src/core/keys/glob-listings.js";
import type { CheckId } from "../../src/core/types/check.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { SLOW } from "../scheduler/cleanup.js";
import { addWorktree, createRepo, openRepoStore } from "../scheduler/repo.js";
import { type Harness, openHarness } from "../scheduler/vitest-harness.js";

/*
 * Row 023-13 (fix A), `023 research/glob-membership.md` S2 to S4 with the
 * real Vitest adapter: a module globs `./plugins/*.ts` and the test expects
 * one plugin. A file added while no daemon ran, or present in another
 * worktree, must not read as the stored pass.
 */

const TEST = "test/registry.test.ts";
const COUNTS: CheckId = { kind: "test", project: "", testPath: TEST, fullName: "counts one" };
const PLUGIN = "src/plugins/new.ts";

const testOf = (module: string) =>
  [
    'import { expect, it } from "vitest";',
    `import { count } from "../${module}";`,
    'it("counts one", () => expect(count).toBe(1));',
    "",
  ].join("\n");

/** A module that globs, the file its pattern matches, one more it would match, and the stored listings. */
interface Variant {
  readonly name: string;
  readonly module: string;
  readonly source: string;
  readonly kept: string;
  readonly added: string;
  /** What to delete to undo the add, when it made a folder. */
  readonly removes?: string;
  readonly listings: (stored: readonly string[]) => void;
}

const counts = (glob: string) =>
  `const plugins = import.meta.glob(${JSON.stringify(glob)}, { eager: true });\nexport const count = Object.keys(plugins).length;\n`;

/** Reviews/wave-2.md B1 and B2: the root, a sibling folder from an enum's module, and one from TSX. */
const VARIANTS: readonly Variant[] = [
  {
    name: "a relative folder",
    module: "src/registry.ts",
    source: `// import.meta.glob('./decoy/*.ts') in a comment lists nothing\n${counts("./plugins/*.ts")}`,
    kept: "src/plugins/kept.ts",
    added: PLUGIN,
    listings: (stored) => expect(stored).toEqual(["src/plugins/"]),
  },
  {
    name: "the root",
    module: "src/registry.ts",
    source: counts("/plugin-*.ts"),
    kept: "plugin-kept.ts",
    added: "plugin-new.ts",
    listings: (stored) => expect(stored).toEqual(["./"]),
  },
  {
    name: "the root, recursively",
    module: "src/registry.ts",
    source: counts("/**/plugin-*.ts"),
    kept: "plugin-kept.ts",
    added: "deep/er/plugin-new.ts",
    removes: "deep",
    listings: (stored) => expect(stored).toEqual(expect.arrayContaining(["./", "src/", "test/"])),
  },
  {
    name: "a sibling folder from a module with an enum",
    module: "src/sub/registry.ts",
    source: `export enum Kind { A }\n${counts("../plugins/*.ts")}`,
    kept: "src/plugins/kept.ts",
    added: PLUGIN,
    listings: (stored) => expect(stored).toEqual(["src/plugins/"]),
  },
  {
    name: "a sibling folder from TSX",
    module: "src/view/registry.tsx",
    source: [
      "/** @jsxRuntime classic */",
      "/** @jsx h */",
      "const h = (tag: string, _props: unknown, ...children: unknown[]) => ({ tag, children });",
      counts("../plugins/*.ts"),
      "export const view = <p>{count}</p>;",
      "",
    ].join("\n"),
    kept: "src/plugins/kept.ts",
    added: PLUGIN,
    listings: (stored) => expect(stored).toEqual(["src/plugins/"]),
  },
];

const FILES: Record<string, string> = {
  "src/plugins/kept.ts": 'export const name = "kept";\n',
  "src/registry.ts": counts("./plugins/*.ts"),
  [TEST]: testOf("src/registry.ts"),
};

/** The `basic` fixture with the glob module, committed. */
function globRepo(variant?: Variant) {
  const repo = createRepo();
  const files =
    variant === undefined
      ? FILES
      : {
          [variant.kept]: 'export const name = "kept";\n',
          [variant.module]: variant.source,
          [TEST]: testOf(variant.module),
        };
  for (const [path, text] of Object.entries(files)) write(repo.main, path, text);
  git(repo.main, ["add", "-A"]);
  git(repo.main, ["commit", "-qm", "glob"]);
  // Row 023-76: a root listing holds every name on disk. The first run writes Vitest's cache
  // under an ignored `node_modules/`; an installed project has that folder before any run.
  mkdirSync(join(repo.main, "node_modules"), { recursive: true });
  return repo;
}

function write(root: string, path: string, text: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

/** A daemon's start in `root`, quiet, then its state of `COUNTS` and its runs of the test. */
async function startIn(
  root: string,
  store: ReturnType<typeof openRepoStore>,
  commonDir: string,
  runMissing = false,
  runtimeInputs = true,
): Promise<Harness> {
  const policy = { ...(runMissing ? RUN_MISSING : {}), observe: { runtimeInputs } };
  const h = await openHarness(root, store, commonDir, { policy });
  await h.scheduler.start();
  await h.quiet();
  return h;
}

async function stop(h: Harness): Promise<void> {
  await h.scheduler.close();
  await h.runner.close();
}

const passes = (h: Harness) => h.sink.stateOf(COUNTS);

describe("a glob's folder membership in keys (row 023-13)", SLOW, () => {
  // The listings key a closure whatever policy `observe.runtimeInputs` says.
  it.each(
    VARIANTS.flatMap((variant) =>
      [true, false].map((observe) => [variant.name, observe, variant] as const),
    ),
  )(
    "a restart reads a file added to %s as stale, and its removal reuses the pass (observe %s)",
    async (_, observe, variant) => {
      const repo = globRepo(variant);
      const store = openRepoStore(repo.commonDir);
      const start = (root: string, runMissing = false) =>
        startIn(root, store, repo.commonDir, runMissing, observe);
      const first = await start(repo.main, true);
      expect(passes(first)).toMatchObject({ outcome: "pass", validity: "current" });
      const stored = JSON.parse(store.meta.get(globListingsMetaKey("")) ?? "{}");
      variant.listings(stored[variant.module] ?? []);
      await stop(first);

      // S2: added while no daemon ran.
      write(repo.main, variant.added, 'export const name = "new";\n');
      const second = await start(repo.main);
      expect(passes(second)?.validity).toBe("stale");
      await stop(second);

      // Removed again: the stored pass is the one at this content, reused with no run.
      rmSync(join(repo.main, variant.removes ?? variant.added), { recursive: true });
      const third = await start(repo.main);
      expect(passes(third)).toMatchObject({ outcome: "pass", validity: "current" });
      expect(third.runsOf(TEST)).toEqual([]);
      await stop(third);
    },
  );

  it("a second worktree at a commit with an added matching file does not inherit the pass", async () => {
    const repo = globRepo();
    const store = openRepoStore(repo.commonDir);
    const first = await startIn(repo.main, store, repo.commonDir, true);
    expect(passes(first)).toMatchObject({ outcome: "pass", validity: "current" });
    await stop(first);

    // S4: the other worktree's commit adds the file; its daemon starts for the first time.
    const other = addWorktree(repo.main, repo.dir, "other");
    write(other, PLUGIN, 'export const name = "new";\n');
    git(other, ["add", "-A"]);
    git(other, ["commit", "-qm", "add new"]);
    const second = await startIn(other, store, repo.commonDir);
    // No state at all: the stored pass is not at this worktree's key, and lookup-only runs nothing.
    expect(passes(second)).toBeNull();
    await stop(second);
  });
});
