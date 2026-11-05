import { readPolicy } from "../core/daemon/policy.js";
import { testFileId } from "../core/keys/index.js";
import { groupView } from "../core/scheduler/slow.js";
import { groupRunText, groupWhenText } from "../core/state/index.js";
import { plural, testFileText } from "../core/text.js";
import {
  type AbsolutePath,
  type CheckMoment,
  type GroupTierState,
  SLOW_GROUP,
  type StatusSnapshot,
  type TestFileRef,
} from "../core/types/index.js";

/*
 * Row 019-24 item 2 (spec 019 D6): what `status --wait`'s verdict lines say
 * of a configured group's test files, by the group's name and its run
 * command, as status's group line names them (`groupTierLines`), never as
 * slow files. Nothing here is read without a `checks` key, so the lines
 * stay as before without one.
 */

/** How many left files a clause names before "and N more", as for slow files. */
const SHOWN = 10;

/**
 * The quiet line's clause for each configured group not all current, in
 * `checks` order: a wait for an edit's work does not hold for a group
 * lane's files (row 019-16, `worktreeLaneFiles`). As the slow clause: a
 * group Stop waits for is required, and the wait does not hold for it;
 * another is not required before the agent finishes. Either names the
 * group's run command.
 */
export function groupsQuietText(snapshot: StatusSnapshot, command: string): string {
  return (snapshot.groupTiers ?? []).map((group) => groupQuietText(group, command)).join("");
}

function groupQuietText(group: GroupTierState, command: string): string {
  const open = group.testFiles - group.current;
  if (open <= 0) return "";
  const them = open === 1 ? "it" : "them";
  const runs =
    group.pending === 0
      ? ""
      : ` and Squeal runs ${group.notRun === 0 ? them : "the pending ones"} ${groupWhenText(group)}`;
  const files = `${plural(open, `${group.name} test file`)} ${open === 1 ? "is" : "are"} not current${runs}`;
  const run = groupRunText(group, command, open);
  return group.stopWaitMs === undefined
    ? `; ${files}; this repository does not require ${them} before you finish; ${run}`
    : `; ${files}, which this wait does not hold for: ${run}`;
}

/** The files of one group a named wait left for the group's moment (`leftForPause`). */
export interface LeftGroup {
  readonly name: string;
  readonly at: CheckMoment;
  /** Stop waits for the group (019 D4): it is required before the agent finishes. */
  readonly stopRequires: boolean;
  readonly files: readonly TestFileRef[];
}

/**
 * With a `checks` key, the files a named wait left for a pause by the group
 * that owns each, in `checks` order, the default `slow` group's included;
 * nothing without the key or with no file left.
 */
export function leftGroupsOf(
  root: AbsolutePath,
  files: readonly TestFileRef[],
): { readonly leftGroups?: readonly LeftGroup[] } {
  const policy = readPolicy(root);
  if (policy.checks.length === 0 || files.length === 0) return {};
  const view = groupView(policy);
  const owners = new Map(files.map((ref) => [testFileId(ref), view.of(ref).name]));
  const leftGroups = view.groups.flatMap((group) => {
    const own = files.filter((ref) => owners.get(testFileId(ref)) === group.name);
    if (own.length === 0) return [];
    const { name, at, stopRequires } = group;
    return [{ name, at, stopRequires, files: own }];
  });
  return { leftGroups };
}

/** Whether a configured group owns any of the left files: the reason words name groups. */
export function leftForGroups(left: readonly LeftGroup[] | undefined): boolean {
  return (left ?? []).some((group) => group.name !== SLOW_GROUP);
}

/**
 * What a group's left files wait for besides `squeal run <group>`, by its
 * moment (D1); `null` at `manual`, which waits for nothing else (row 019-47).
 */
const LEFT_FOR: Readonly<Record<CheckMoment, string | null>> = {
  edit: "the group's turn",
  pause: "a pause",
  stop: "a pause",
  commit: "a commit",
  manual: null,
};

/**
 * A named wait's clause for a configured group's left files, as the slow
 * clause (`pauseText`, task 004-78) words slow files: what they wait for,
 * that this wait does not hold for them, by path, and what the policy asks
 * of them, with the group's run command.
 */
export function leftGroupText(group: LeftGroup, command: string): string {
  const n = group.files.length;
  const shown = group.files.slice(0, SHOWN).map(testFileText).join(", ");
  const more = n > SHOWN ? ` and ${n - SHOWN} more` : "";
  const them = n === 1 ? "it" : "them";
  const run = `\`${command} run ${group.name} --wait 60000\``;
  const other = LEFT_FOR[group.at];
  const what =
    `${plural(n, `${group.name} test file`)} ${n === 1 ? "waits" : "wait"} for ${other === null ? "" : `${other} or `}` +
    `\`${command} run ${group.name}\`, which this wait does not hold for: ${shown}${more}`;
  const results = n === 1 ? "its result" : "their results";
  // Row 019-47: nothing but the run starts a `manual` group's files.
  const does =
    other === null ? `runs ${them} now and waits for ${results}` : `waits for ${results}`;
  return group.stopRequires
    ? `${what}; this repository requires ${them} before you finish: ${run} runs and waits for ${them}`
    : `${what}; this repository does not require ${them} before you finish; ${run} ${does}`;
}
