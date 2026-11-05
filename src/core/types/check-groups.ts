import type { LintTool } from "./lint.js";

/*
 * Spec 019 D1 to D3: check groups, their moments and limits. `CheckGroup` is
 * one `checks` entry as the policy file gives it, after the loader kept it;
 * `ResolvedGroup` is a group with every default applied, today's keys
 * included (D2), as `resolveGroups` returns it.
 */

/** D1: when a group runs on its own, from soonest to latest; `manual`, never (row 019-47). */
export type CheckMoment = "edit" | "pause" | "stop" | "commit" | "manual";

/** D1: a test group's runner, by its `squeal.config.json` key. */
export type CheckRunner = "vitest" | "nodeTest" | "pytest";

/** D3: `"low"` runs the group's processes under `nice` 10 and `ionice -c 3`. */
export type CheckPriority = "normal" | "low";

/** D3: today's load guard (004 D3) for one group. */
export interface DeferUnderLoad {
  /** One-minute load average per CPU above which a run waits. */
  readonly maxLoadPerCpu: number;
  /** How long a run waits at most before it starts anyway. */
  readonly maxDeferMs: number;
}

/** D3: `checks[].limits` as given; an absent key is no limit. */
export interface CheckGroupLimits {
  /** The most of the group's files running at once across every worktree of the user. */
  readonly maxParallel?: number;
  /** Workers inside one run of the group. */
  readonly maxWorkers?: number;
  /** Default `"normal"`. */
  readonly priority?: CheckPriority;
  /** Absent keys take today's slow defaults, 1.0 and 600000. */
  readonly deferUnderLoad?: Partial<DeferUnderLoad>;
}

/** D1: the keys every group has. */
interface CheckGroupCommon {
  /** Unique among `checks`; never `tests` or `slow`, the default groups (D2). */
  readonly name: string;
  readonly at: CheckMoment;
  /** Groups this group follows at its moment (D1). Absent means none. */
  readonly after?: readonly string[];
  /** At `edit`, how old the latest revision must be before the group starts. Absent means 0. */
  readonly quietMs?: number;
  readonly limits?: CheckGroupLimits;
}

/** D1: a group of test files of one runner. */
export interface TestCheckGroup extends CheckGroupCommon {
  readonly runner: CheckRunner;
  /** One Vitest project, or one `nodeTest` or `pytest` entry, by name. */
  readonly project?: string;
  /** Worktree-relative test-file globs that narrow the selection, as `slow.include`'s. */
  readonly tests?: readonly string[];
}

/** D1: a group of lint checks; `true` is every tool. */
export interface LintCheckGroup extends CheckGroupCommon {
  readonly lint: true | readonly LintTool[];
}

/** One `checks` entry the loader kept. */
export type CheckGroup = TestCheckGroup | LintCheckGroup;

/** D3: a group's limits with the defaults applied; `null` is no limit. */
export interface ResolvedLimits {
  readonly maxParallel: number | null;
  readonly maxWorkers: number | null;
  readonly priority: CheckPriority;
  readonly deferUnderLoad: DeferUnderLoad | null;
}

/** What a resolved group selects. */
export type GroupSelector =
  | {
      readonly kind: "tests";
      readonly runner: CheckRunner;
      /** `null`: every project of the runner. */
      readonly project: string | null;
      /** `null`: every file. */
      readonly tests: readonly string[] | null;
    }
  | {
      readonly kind: "lint";
      /** `null`: every tool. */
      readonly tools: readonly LintTool[] | null;
    }
  | {
      /** D2's default groups: every test file whose slow marking is `slow`. */
      readonly kind: "marked";
      readonly slow: boolean;
      /** `slow.include`. */
      readonly include: readonly string[];
      /** The `nodeTest` and `pytest` entries marked `slow: true`. */
      readonly projects: readonly { readonly runner: CheckRunner; readonly name: string }[];
    };

/** One group with every default applied (D1, D2). */
export interface ResolvedGroup {
  readonly name: string;
  /** Its index in `checks`, or `null` for a default group (D2). */
  readonly index: number | null;
  readonly at: CheckMoment;
  /**
   * D4: Stop waits for the group's checks. `at === "stop"` for every group
   * but the default `slow` group under `stop.requireSlowSuite` with
   * `slow.trigger: "continuous"`, which starts at `edit` as today.
   */
  readonly stopRequires: boolean;
  readonly after: readonly string[];
  readonly quietMs: number;
  readonly limits: ResolvedLimits;
  readonly select: GroupSelector;
}

/** One check a group may own: a test file of one runner and project, or a lint check. */
export type GroupCheck =
  | {
      readonly kind: "test";
      readonly runner: CheckRunner;
      readonly project: string;
      /** Worktree-relative. */
      readonly path: string;
    }
  | { readonly kind: "lint"; readonly tool: LintTool; readonly path: string };
