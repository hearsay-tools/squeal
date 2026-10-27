import { describe, expect, it } from "vitest";
import { readCursor } from "../../src/core/code/pass/cursor.js";
import { readRecount } from "../../src/core/code/pass/index.js";
import {
  type CodeStore,
  isCodeStoreOpenFailure,
  openCodeStore,
} from "../../src/core/code/store/index.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { runMissingConfig } from "../helpers/baseline.js";
import { SLOW } from "./helpers.js";
import { type Entry, type ReloadRepo, reloadRepo } from "./reload-projects-kit.js";

/*
 * Row 015-87 (015 D1 as amended 2026-10-27; 011 C10, *Projects at a
 * reload*), through a real daemon with one node:test project: a
 * `squeal.config.json` save that does not parse keeps the last good
 * `complexity`, `coverage` and `crap` settings beside the projects, so
 * neither it nor the good file again re-keys a check or runs a file, and
 * the code states keep their thresholds. A valid `coverage.enabled` change
 * still re-keys the project's checks (015 D8, row 015-86), with no restart.
 */

const ONE: Entry = { name: "one", cwd: "one" };
const FILES = { "one/a.test.mjs": { name: "a" }, "one/b.test.mjs": { name: "b" } };
/** Not the default 20: `pick`, of complexity 4, is over it. */
const COMPLEXITY = { threshold: 3 };
/** Complexity 4 and no test loads it: CRAP 4² + 4 = 20, and no test runs it. */
const PICK = `export function pick(x) {
  if (x === 1) return "a";
  if (x === 2) return "b";
  if (x === 3) return "c";
  return "d";
}
`;
const COMPLEX = ["complexity", "fail", 4, 3];
const UNTESTED = ["uncovered", "fail", null, null];

type Settings = Readonly<Record<string, unknown>>;

/** The fixture's config with `settings`, as `ReloadRepo.config` writes it. */
const configText = (settings: Settings) =>
  runMissingConfig(
    JSON.stringify({ ...settings, nodeTest: [{ include: ["*.test.mjs"], ...ONE }] }),
  );

/** `fn` over the code store as a reader opens it; `null` while it does not exist. */
function code<T>(repo: ReloadRepo, fn: (store: CodeStore) => T): T | null {
  const store = openCodeStore(repo.commonDir, DEFAULT_POLICY, { create: false });
  if (isCodeStoreOpenFailure(store)) return null;
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

const latest = (repo: ReloadRepo) =>
  repo.store((store) => store.revisions.latest(repo.worktreeId)?.number ?? 0);

/** `pick`'s states: measure, outcome, value and threshold. */
const picked = (repo: ReloadRepo, store: CodeStore) =>
  store.states
    .list(repo.worktreeId)
    .filter((state) => state.check.path === "lib/pick.mjs")
    .map((state) => [state.measure, state.outcome, state.value, state.threshold])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

/** Once the code pass reached the latest revision: the threshold it judged by, its last recount and `pick`'s states. */
async function counted(repo: ReloadRepo) {
  const revision = latest(repo);
  await repo.until(
    `the code pass at revision ${revision}`,
    () => (code(repo, (s) => readCursor(s.meta, repo.worktreeId)?.revision) ?? -1) >= revision,
  );
  return code(repo, (s) => ({
    threshold: readCursor(s.meta, repo.worktreeId)?.threshold,
    recount: readRecount(s.meta, repo.worktreeId),
    pick: picked(repo, s),
  }));
}

/** The reload notes so far; one more after each save the daemon read. */
const reloads = (repo: ReloadRepo) =>
  repo.notes().filter((text) => text.startsWith("squeal.config.json changed; policy reloaded"));

/** What a save must leave as it was: each file's key and how often each test ran. */
const ran = (repo: ReloadRepo) => ({
  keys: repo.rows().map((row) => [row.testFile.path, row.key]),
  runs: [repo.runs("a"), repo.runs("b")],
});

/** Writes `text` as the config, then waits for its reload and every check after it. */
async function save(repo: ReloadRepo, text: string): Promise<void> {
  const before = reloads(repo).length;
  repo.write("squeal.config.json", text);
  await repo.until("the reload", () => reloads(repo).length > before);
  await repo.settle();
}

/** A started daemon's identity in the store, which a restart replaces. */
const daemonOf = (repo: ReloadRepo) =>
  repo.store((store) => {
    const daemon = store.worktrees.get(repo.worktreeId)?.daemon;
    return { startedAt: daemon?.startedAt, token: daemon?.token };
  });

/** Each good config: its settings and `pick`'s states under it. */
const CASES: readonly [string, Settings, readonly unknown[][]][] = [
  [
    "coverage on and a CRAP threshold of 15",
    { complexity: COMPLEXITY, coverage: { enabled: true }, crap: { threshold: 15 } },
    [COMPLEX, ["crap", "fail", 20, 15], UNTESTED],
  ],
  [
    "coverage on and CRAP off",
    { complexity: COMPLEXITY, coverage: { enabled: true }, crap: { enabled: false } },
    [COMPLEX, UNTESTED],
  ],
  ["coverage off", { complexity: COMPLEXITY, coverage: { enabled: false } }, [COMPLEX]],
];

describe("a config that does not parse keeps the code settings (row 015-87)", SLOW, () => {
  it.each(CASES)(
    "with %s, neither it nor the good file again re-keys or runs a check",
    async (_, settings, states) => {
      const repo = await reloadRepo([ONE], FILES, settings);
      await repo.ran("the baseline", 2);
      repo.write("lib/pick.mjs", PICK);
      const judged = (s: CodeStore) => JSON.stringify(picked(repo, s)) === JSON.stringify(states);
      await repo.until("pick judged", () => code(repo, judged) === true);
      const good = await counted(repo);
      expect(good?.threshold).toBe(3);
      await repo.settle();
      const before = ran(repo);
      expect(before.runs).toEqual([1, 1]);

      // A trailing comma, as a half-typed save leaves it.
      await save(repo, '{ "nodeTest": [], }\n');
      expect(reloads(repo).at(-1)).toMatch(/not valid JSON/);
      expect(ran(repo)).toEqual(before);
      expect(await counted(repo)).toEqual(good);

      await save(repo, configText(settings));
      expect(ran(repo)).toEqual(before);
      expect(await counted(repo)).toEqual(good);
    },
  );

  it("re-keys the project's checks at a valid coverage change, with no restart", async () => {
    const off = { complexity: COMPLEXITY, coverage: { enabled: false } };
    const repo = await reloadRepo([ONE], FILES, off);
    await repo.ran("the baseline", 2);
    await repo.settle();
    const before = ran(repo);
    const daemon = daemonOf(repo);

    await save(repo, configText({ ...off, coverage: { enabled: true } }));
    await repo.ran("the coverage-on keys", 2);
    const on = ran(repo);
    expect(on.runs).toEqual([2, 2]);
    for (const [i, [path, key]] of on.keys.entries()) {
      expect(path).toBe(before.keys[i]?.[0]);
      expect(key).not.toBe(before.keys[i]?.[1]);
    }

    await save(repo, configText(off));
    await repo.ran("the coverage-off keys", 2);
    expect(ran(repo).keys).toEqual(before.keys);
    expect(daemonOf(repo)).toEqual(daemon);
  });
});
