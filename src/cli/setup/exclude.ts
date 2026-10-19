import { posix } from "node:path";
import { POLICY_FILE } from "../../core/daemon/policy.js";
import { isRecord } from "../../core/fs/index.js";
import { globToRegExp } from "../../core/keys/glob.js";
import type { ExcludeProposal, Runners, SetupPlan } from "./plan.js";

/*
 * Row 005-70, spec 005 D3 "Slow tests and build-output tests" step 4: a
 * group answered "leave these tests to CI" goes in each runner's `exclude`
 * that lists its files (`vitest.exclude`, `nodeTest[].exclude`; 004 D7), the
 * node:test glob relative to the project's `cwd` as its `exclude` takes it.
 */

type Target = ExcludeProposal["into"][number];

/**
 * Where worktree-relative `glob` goes: Vitest's `exclude` when `isVitest`
 * holds for any of `files`, and each node:test project's that lists any.
 */
export function excludeInto(
  runners: Runners,
  glob: string,
  files: readonly string[],
  isVitest: (file: string) => boolean,
): Target[] {
  const into: Target[] = [];
  if (runners.vitest && files.some(isVitest)) into.push({ runner: "vitest", glob });
  for (const p of runners.nodeTest) {
    const lists = matcher(p.include.map((g) => posix.join(p.cwd, g)));
    if (!files.some(lists)) continue;
    const relative =
      p.cwd === "" ? glob : glob.startsWith(`${p.cwd}/`) ? glob.slice(p.cwd.length + 1) : null;
    // A glob outside the project's directory has no form its `exclude` takes.
    if (relative !== null) into.push({ runner: "nodeTest", project: p.name, glob: relative });
  }
  return into;
}

/** The keys a proposal writes, as the question and the plan name them. */
export function excludeKeys(proposal: ExcludeProposal): string {
  const keys = proposal.into.map((i) =>
    i.runner === "vitest" ? "vitest.exclude" : `nodeTest "${i.project}" exclude`,
  );
  return keys.join(" and ") || "no runner's exclude lists them";
}

/** The targets of each `--exclude` glob: its group's proposal, else read off the test files. */
function excludeTargets(
  plan: SetupPlan,
  testFiles: readonly string[],
  globs: readonly string[],
): Target[] {
  return globs.flatMap((glob) => {
    const group = plan.slow.groups.find((g) => g.exclude?.glob === glob);
    if (group?.exclude != null) return [...group.exclude.into];
    const selects = matcher([glob]);
    return excludeInto(plan.runners, glob, testFiles.filter(selects), () => true);
  });
}

/**
 * Adds each `--exclude` glob to its runners' `exclude` in `config`, and drops
 * each `inputs` key whose test files it then all excludes, as no test file
 * would read them; the lines say what changed.
 */
export function addExcludes(
  config: Record<string, unknown>,
  plan: SetupPlan,
  testFiles: readonly string[],
  globs: readonly string[],
): string[] {
  const lines: string[] = [];
  const targets = excludeTargets(plan, testFiles, globs);
  const add = (holder: Record<string, unknown>, glob: string, where: string) => {
    const list = Array.isArray(holder.exclude) ? [...(holder.exclude as unknown[])] : [];
    if (list.includes(glob)) return holder;
    lines.push(`added ${glob} to ${where} in ${POLICY_FILE}`);
    return { ...holder, exclude: [...list, glob] };
  };
  for (const target of targets) {
    if (target.runner === "vitest") {
      config.vitest = add(
        isRecord(config.vitest) ? config.vitest : {},
        target.glob,
        "vitest.exclude",
      );
      continue;
    }
    const projects = Array.isArray(config.nodeTest) ? [...(config.nodeTest as unknown[])] : [];
    const at = projects.findIndex((p) => isRecord(p) && p.name === target.project);
    if (at === -1) {
      lines.push(
        `nodeTest project "${target.project}" is not in ${POLICY_FILE}; give it exclude ["${target.glob}"] when you add it`,
      );
      continue;
    }
    projects[at] = add(
      projects[at] as Record<string, unknown>,
      target.glob,
      `nodeTest "${target.project}" exclude`,
    );
    config.nodeTest = projects;
  }
  const excluded = matcher(globs);
  if (globs.length > 0 && isRecord(config.inputs)) {
    const inputs = { ...config.inputs };
    for (const key of Object.keys(inputs)) {
      const selected = testFiles.filter(matcher([key]));
      if (selected.length === 0 || !selected.every(excluded)) continue;
      delete inputs[key];
      lines.push(`removed inputs["${key}"] from ${POLICY_FILE}: its test files are excluded`);
    }
    config.inputs = inputs;
  }
  return lines;
}

function matcher(globs: readonly string[]): (path: string) => boolean {
  const patterns = globs.flatMap((glob) => {
    try {
      return [globToRegExp(glob)];
    } catch {
      return [];
    }
  });
  return (path) => patterns.some((pattern) => pattern.test(path));
}
