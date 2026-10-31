import { isDeepStrictEqual } from "node:util";
import { loadPolicy, POLICY_FILE } from "../daemon/policy.js";
import { isNewerVersion, squealVersion } from "../daemon/version.js";
import { listPaths } from "../text.js";
import {
  type DaemonLiveness,
  DEFAULT_POLICY,
  type IgnoredConfigRule,
  type Policy,
  type WorktreeRecord,
} from "../types/index.js";

/**
 * Row 011-275 (gh-120): the keys whose loss has a known cost, each with the
 * Squeal version that added it, so a daemon older than that version does not
 * apply it. A runtime knows the cost only of keys it knows; any key it does
 * not know reads "not applied" alone.
 */
const ADDED: { readonly [K in keyof Policy]?: { readonly in: string; readonly cost: string } } = {
  // `research/issue-120.md`: 0.1.369 added it; without it, the observed files stay in the keys.
  runtimeFiles: {
    in: "0.1.369",
    cost: "extra re-runs: a change to a runtime file it names re-runs the tests that read it",
  },
};

/**
 * Row 011-275 (gh-120; 011 C6, C10): the `squeal.config.json` keys at
 * `root` that a runtime of this worktree does not apply. Those this
 * runtime's loader does not know, with the live daemon's version when it
 * differs, since that daemon may apply them; and each key of `ADDED` the
 * file sets apart from its default while the live daemon is older than the
 * version that added it. `daemon` is the live daemon's recorded version,
 * `null` with none. Absent when there is none, so status is as before.
 */
export function ignoredConfigOf(
  root: string,
  daemon: string | null,
  own: string = squealVersion(),
): { ignoredConfig?: readonly IgnoredConfigRule[] } {
  const { policy, unknownKeys = [] } = loadPolicy(root);
  const differs = daemon !== null && daemon !== own ? { daemonVersion: daemon } : {};
  const rules: IgnoredConfigRule[] = unknownKeys.map((key) => ({
    key,
    by: "command",
    version: own,
    ...differs,
  }));
  for (const [key, added] of Object.entries(ADDED)) {
    const name = key as keyof Policy;
    if (daemon === null || !isNewerVersion(added.in, daemon)) continue;
    if (isDeepStrictEqual(policy[name], DEFAULT_POLICY[name])) continue;
    rules.push({ key, by: "daemon", version: daemon, addedIn: added.in, cost: added.cost });
  }
  return rules.length === 0 ? {} : { ignoredConfig: rules };
}

/**
 * The version of the daemon `worktree` records while `liveness` says it
 * serves: alive and not stopping. `null` otherwise: no daemon applies the
 * policy now, or one replaces it.
 */
export function liveDaemonVersion(
  worktree: WorktreeRecord | null,
  liveness: DaemonLiveness | undefined,
): string | null {
  const serving = liveness?.state === "alive" && liveness.stopping === undefined;
  return serving ? (worktree?.daemon?.squealVersion ?? null) : null;
}

/** `ignoredConfigOf` the worktree `worktree` records, beside its live daemon; none without a record. */
export function ignoredConfigAt(
  worktree: WorktreeRecord | null,
  liveness: DaemonLiveness | undefined,
): { ignoredConfig?: readonly IgnoredConfigRule[] } {
  return worktree === null
    ? {}
    : ignoredConfigOf(worktree.root, liveDaemonVersion(worktree, liveness));
}

/**
 * The status and registration lines for `ignoredConfig`: one for the keys
 * this runtime does not know, then one per key an older daemon leaves out,
 * each with its restart or update path. `own` is this runtime's version,
 * the one `squeal start` starts. None without the field.
 */
export function ignoredConfigLines(
  result: { readonly ignoredConfig?: readonly IgnoredConfigRule[] },
  command: string,
  own: string = squealVersion(),
): string[] {
  const rules = result.ignoredConfig ?? [];
  const unknown = new Map<string, IgnoredConfigRule[]>();
  for (const rule of rules.filter((r) => r.by === "command")) {
    const group = `${rule.version} ${rule.daemonVersion ?? ""}`;
    unknown.set(group, [...(unknown.get(group) ?? []), rule]);
  }
  return [
    ...[...unknown.values()].map((group) => unknownLine(group, command)),
    ...rules
      .filter((r) => r.by === "daemon")
      .map(
        (r) =>
          `Not applied: ${POLICY_FILE} key "${r.key}": the daemon runs squeal ${r.version}${r.addedIn === undefined ? ", which does not apply it" : `, older than ${r.addedIn}, which added it`}.${r.cost === undefined ? "" : ` Cost: ${r.cost}.`} \`${command} stop\`, then \`${command} start\`, starts squeal ${own} in its place.`,
      ),
  ];
}

/** The line for keys one runtime does not know, all of one version and live daemon. */
function unknownLine(rules: readonly IgnoredConfigRule[], command: string): string {
  const [first] = rules;
  const one = rules.length === 1;
  const it = one ? "it" : "them";
  const keys = listPaths(rules.map((r) => `"${r.key}"`));
  const daemon =
    first?.daemonVersion === undefined
      ? ""
      : `; the daemon runs squeal ${first.daemonVersion}, and whether it applies ${it} is not known`;
  return [
    `Not applied: ${POLICY_FILE} ${one ? "key" : "keys"} ${keys} ${one ? "is" : "are"} unknown to squeal ${first?.version}, the version that read ${it} here:`,
    `${one ? "a typo, or a key" : "typos, or keys"} a newer Squeal added. Validation goes on without ${it}${daemon}.`,
    `\`${command} setup --check\` names each problem; \`${command} update\` installs the newest Squeal, and a session keeps the version it started on until it restarts.`,
  ].join(" ");
}
