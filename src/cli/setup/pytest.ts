import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { POLICY_FILE } from "../../core/daemon/policy.js";
import { isRecord } from "../../core/fs/index.js";
import type { AbsolutePath, Policy } from "../../core/types/index.js";
import { seedPytest } from "../pytest-seed.js";
import type { SetupPlan } from "./plan.js";
import type { RepoFacts } from "./repo.js";

/*
 * Spec 007 D1's setup paragraph on 005 D3: the plan lists the pytest
 * projects the config declares, or else those setup would seed, and
 * applying the choices writes the seeded ones into `squeal.config.json`.
 */

/** One pytest project of the plan, as `Runners.nodeTest`'s, with the seed's notes. */
export interface PytestRunner {
  readonly name: string;
  readonly cwd: string;
  readonly include: readonly string[];
  readonly exclude?: readonly string[];
  readonly source: "config" | "seed";
  /** The seed's notes on this project: a refused `addopts` flag, no environment yet. */
  readonly notes: readonly string[];
}

/**
 * The declared pytest projects when the config lists any; else what setup
 * would seed. An empty list counts as none declared: `squeal init` writes
 * `pytest: []` among its defaults.
 */
export function pytestRunners(
  facts: RepoFacts,
  policy: Policy,
  raw: unknown,
  env: Readonly<Record<string, string | undefined>>,
): PytestRunner[] {
  if (declaresPytest(raw)) {
    return policy.pytest.map((p) => ({
      name: p.name,
      cwd: p.cwd ?? "",
      include: p.include,
      ...(p.exclude === undefined ? {} : { exclude: p.exclude }),
      source: "config",
      notes: [],
    }));
  }
  let seed: ReturnType<typeof seedPytest>;
  try {
    seed = seedPytest(facts.root, facts.tracked, env);
  } catch {
    return [];
  }
  return seed.projects.map((p) => ({
    name: p.name,
    cwd: p.cwd ?? "",
    include: p.include,
    ...(p.exclude === undefined ? {} : { exclude: p.exclude }),
    source: "seed",
    notes: seed.notes.filter((n) => n.startsWith(`pytest project "${p.name}"`)),
  }));
}

/** Whether the config's `pytest` key lists a project. */
export function declaresPytest(raw: unknown): boolean {
  return isRecord(raw) && Array.isArray(raw.pytest) && raw.pytest.length > 0;
}

/**
 * Writes the plan's seeded pytest projects as `pytest` in the config, keeping
 * every other key, when it still declares none; the lines say what changed.
 * Throws only on a failed write.
 */
export function writePytestSeed(root: AbsolutePath, plan: SetupPlan): string[] {
  const seeded = (plan.runners.pytest ?? []).filter((p) => p.source === "seed");
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
  if (declaresPytest(config)) return [];
  config.pytest = seeded.map(({ name, cwd, include, exclude }) => ({
    name,
    ...(cwd === "" ? {} : { cwd }),
    include,
    ...(exclude === undefined ? {} : { exclude }),
  }));
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? 2;
  writeFileSync(path, `${JSON.stringify(config, null, indent)}\n`);
  return [
    ...seeded.map((p) => `seeded pytest project "${p.name}" in ${POLICY_FILE}`),
    ...seeded.flatMap((p) => p.notes),
  ];
}
