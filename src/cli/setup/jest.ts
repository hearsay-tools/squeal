import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { POLICY_FILE } from "../../core/daemon/policy.js";
import { isRecord } from "../../core/fs/json.js";
import type { AbsolutePath } from "../../core/types/common.js";
import type { Policy } from "../../core/types/policy.js";
import { seedJest } from "../jest-seed.js";
import type { SetupPlan } from "./plan.js";
import type { RepoFacts } from "./repo.js";

/*
 * Spec 028 D1.2 on 005 D3: the plan lists the Jest projects the config
 * declares, or else those setup would seed, and applying the choices writes
 * the seeded ones into `squeal.config.json`, as `pytest.ts` does for pytest.
 */

/** One Jest project of the plan, with the seed's notes. */
export interface JestRunner {
  readonly name: string;
  /** Worktree-relative: the Jest config file, or a `package.json` with a `jest` key. */
  readonly config: string;
  /** Worktree-relative folder Jest runs from, `""` for the root. */
  readonly cwd: string;
  readonly source: "config" | "seed";
  /** The seed's notes on this project: no Jest installed yet, a config that failed to read. */
  readonly notes: readonly string[];
}

/** The Jest projects of the plan, and the seed's notes on configs it did not seed. */
export interface JestRunners {
  readonly projects: readonly JestRunner[];
  /** A skipped catch-all root config, an expanded `projects` list. Empty for declared projects. */
  readonly notes: readonly string[];
}

/**
 * The declared Jest projects when the config lists any; else what setup
 * would seed. An empty list counts as none declared, as for `pytest`.
 */
export async function jestRunners(
  facts: RepoFacts,
  policy: Policy,
  raw: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<JestRunners> {
  if (declaresJest(raw)) {
    return {
      projects: policy.jest.map((p) => ({
        name: p.name,
        config: p.config,
        cwd: p.cwd ?? dirOf(p.config),
        source: "config",
        notes: [],
      })),
      notes: [],
    };
  }
  const taken = new Set([...policy.nodeTest, ...policy.pytest].map((p) => p.name));
  let seed: Awaited<ReturnType<typeof seedJest>>;
  try {
    seed = await seedJest(facts.root, facts.tracked, env, taken);
  } catch {
    return { projects: [], notes: [] };
  }
  const own = (name: string) => (note: string) => note.startsWith(`jest project "${name}"`);
  return {
    projects: seed.projects.map((p) => ({
      name: p.name,
      config: p.config,
      cwd: p.cwd ?? dirOf(p.config),
      source: "seed",
      notes: seed.notes.filter(own(p.name)),
    })),
    notes: seed.notes.filter(
      (n) => !n.startsWith("seeded jest project") && !seed.projects.some((p) => own(p.name)(n)),
    ),
  };
}

/** Whether the config's `jest` key lists a project. */
export function declaresJest(raw: unknown): boolean {
  return isRecord(raw) && Array.isArray(raw.jest) && raw.jest.length > 0;
}

/**
 * Writes the plan's seeded Jest projects as `jest` in the config, keeping
 * every other key, when it still declares none; the lines say what changed.
 * Throws only on a failed write.
 */
export function writeJestSeed(root: AbsolutePath, plan: SetupPlan): string[] {
  const seeded = (plan.runners.jest ?? []).filter((p) => p.source === "seed");
  if (seeded.length === 0) return [];
  const path = join(root, POLICY_FILE);
  let text = "";
  let config: Record<string, unknown> = {};
  try {
    text = readFileSync(path, "utf8");
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) return [];
    config = value;
  } catch {
    if (text !== "") return [];
  }
  if (declaresJest(config)) return [];
  config.jest = seeded.map(({ name, config: file, cwd }) => ({
    name,
    config: file,
    ...(cwd === dirOf(file) ? {} : { cwd }),
  }));
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? 2;
  writeFileSync(path, `${JSON.stringify(config, null, indent)}\n`);
  return [
    ...seeded.map((p) => `seeded jest project "${p.name}" in ${POLICY_FILE}`),
    ...seeded.flatMap((p) => p.notes),
  ];
}

/** A worktree-relative file's folder, `""` at the root. */
function dirOf(file: string): string {
  const dir = dirname(file);
  return dir === "." ? "" : dir;
}
