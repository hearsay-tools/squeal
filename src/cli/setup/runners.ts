import { posix } from "node:path";
import { POLICY_FILE } from "../../core/daemon/policy.js";
import { vitestBelowRoot, vitestDetected } from "../../core/daemon/runner.js";
import { isRecord } from "../../core/fs/index.js";
import type { NodeTestProject, Policy } from "../../core/types/index.js";
import { type NodeTestSeed, seedNodeTest } from "../node-test-seed.js";
import type { NodeTestLeftOut, PytestOverlap, Runners, Warmup } from "./plan.js";
import type { PytestRunner } from "./pytest.js";
import type { RepoFacts } from "./repo.js";
import { projectFiles } from "./test-globs.js";

/*
 * The plan's runners (005 D3 step 2 as amended 2026-10-22, rows 005-79 and
 * 005-80): Vitest as 003 D7 detects it, so the plan and the daemon agree,
 * and what the config leaves out or runs twice, each with its fix.
 */

/** A node:test project as the plan reads it: declared, or what `squeal init` would seed. */
export type PlanNodeTestProject = Pick<NodeTestProject, "name" | "cwd" | "include" | "exclude"> & {
  readonly source: "config" | "seed";
};

/**
 * The node:test projects the config declares, else those `squeal init` would
 * seed; and, while it declares none, the `node --test` scripts it leaves out
 * with the seed's notes and templates (003 D1). `nodeTest: []` leaves out
 * the scripts the seed takes too, each with its entry as the template.
 */
export function nodeTestProjects(
  facts: RepoFacts,
  policy: Policy,
  raw: unknown,
): { readonly projects: readonly PlanNodeTestProject[]; readonly leftOut: NodeTestLeftOut } {
  const declared = isRecord(raw) && "nodeTest" in raw;
  if (declared && policy.nodeTest.length > 0) {
    return {
      projects: policy.nodeTest.map((p) => ({ ...p, source: "config" as const })),
      leftOut: { notes: [], templates: [] },
    };
  }
  const seed = seeded(facts.root);
  const refused = seed.notes.filter((note) => !note.startsWith(SEEDED));
  if (!declared) {
    return {
      projects: seed.projects.map((p) => ({ ...p, source: "seed" as const })),
      leftOut: { notes: refused, templates: seed.templates },
    };
  }
  return {
    projects: [],
    leftOut: {
      notes: [...seed.projects.map(notDeclared), ...refused],
      templates: [...seed.projects, ...seed.templates],
    },
  };
}

/** The seed's prefix for a script it takes (`seedNodeTest`'s notes). */
const SEEDED = "seeded nodeTest project";

function notDeclared(project: NodeTestSeed["projects"][number]): string {
  const dir = project.cwd ?? "";
  const script =
    dir !== "" && project.name.startsWith(`${dir}:`)
      ? project.name.slice(dir.length + 1)
      : project.name;
  const where = dir === "" ? "package.json" : `${dir}/package.json`;
  return `script "${script}" in ${where} runs node --test, and ${POLICY_FILE} declares no node:test project; add its nodeTest entry from the template below`;
}

/** What `squeal init` would seed; nothing when a manifest cannot be read, as init then reports. */
function seeded(root: string): NodeTestSeed {
  try {
    return seedNodeTest(root);
  } catch {
    return { projects: [], notes: [], templates: [] };
  }
}

export function readRunners(
  facts: RepoFacts,
  nodeTest: ReturnType<typeof nodeTestProjects>,
  pytest: readonly PytestRunner[],
): Runners {
  return {
    vitest: vitestDetected(facts.root),
    vitestBelowRoot: vitestBelowRoot(facts.root, facts.manifests),
    nodeTest: nodeTest.projects.map((p) => ({
      name: p.name,
      cwd: p.cwd ?? "",
      include: p.include,
      source: p.source,
    })),
    nodeTestLeftOut: nodeTest.leftOut,
    pytest,
    pytestOverlaps: pytestOverlaps(facts, pytest),
  };
}

/** Each pair of pytest projects that select some of the same tracked test files, with the fix. */
function pytestOverlaps(facts: RepoFacts, pytest: readonly PytestRunner[]): PytestOverlap[] {
  const files = pytest.map((p) => new Set(projectFiles(facts, p)));
  const overlaps: PytestOverlap[] = [];
  pytest.forEach((a, i) => {
    for (let j = i + 1; j < pytest.length; j++) {
      const b = pytest[j] as PytestRunner;
      const shared = [...(files[i] as Set<string>)].filter((f) => files[j]?.has(f)).length;
      if (shared > 0) {
        overlaps.push({ projects: [a.name, b.name], testFiles: shared, fix: overlapFix(a, b) });
      }
    }
  });
  return overlaps;
}

/** The project whose `cwd` holds the other's excludes it; else either project gives the files up. */
function overlapFix(a: PytestRunner, b: PytestRunner): string {
  const wide = a.cwd === b.cwd ? null : under(b.cwd, a.cwd) ? a : under(a.cwd, b.cwd) ? b : null;
  if (wide === null) {
    return `keep each test file in one project: narrow the include of pytest project "${b.name}" or add the shared files to its exclude`;
  }
  const narrow = wide === a ? b : a;
  return `add "${posix.relative(wide.cwd, narrow.cwd)}/**" to the exclude of pytest project "${wide.name}"`;
}

/** Whether `dir` is `parent` or lies under it; `""` is the root. */
function under(dir: string, parent: string): boolean {
  return parent === "" || dir === parent || dir.startsWith(`${parent}/`);
}

/**
 * D3 step 2: one run per project and test file, as the daemon runs them.
 * From the store when a daemon listed them; else Vitest's files when 003 D7
 * detects it and each listed project's tracked files.
 */
export function warmupOf(
  facts: RepoFacts,
  runners: Runners,
  projects: readonly Pick<NodeTestProject, "cwd" | "include" | "exclude">[],
): Warmup {
  const { testFiles } = facts;
  if (testFiles.source === "store") {
    const runs = testFiles.runs ?? testFiles.paths.length;
    return {
      source: "store",
      testFiles: runs,
      paths: testFiles.paths.length,
      withoutCurrentResult: Math.max(0, runs - (testFiles.current ?? 0)),
    };
  }
  const listed = [
    ...(runners.vitest ? [testFiles.paths] : []),
    ...projects.map((p) => projectFiles(facts, p)),
  ];
  const runs = listed.reduce((sum, files) => sum + files.length, 0);
  return {
    source: testFiles.source,
    testFiles: runs,
    paths: new Set(listed.flat()).size,
    withoutCurrentResult: runs,
  };
}
