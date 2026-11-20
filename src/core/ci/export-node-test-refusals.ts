import { compare } from "../fs/compare.js";
import { configFieldHash } from "../keys/environment-descriptor.js";
import type { NamedPart } from "./export-check.js";
import type { NodeTestEntryHere } from "./export-node-test.js";
import { ownValue } from "./own-map.js";
import type { PartNodeTest } from "./parts.js";

/*
 * Spec 018 D26.2 to D26.4 (rows 018-48, 018-53): why one `nodeTest`
 * entry's files are left out, by the processes that ran for it
 * (`export-node-test.ts` decides which those are): another Node, another
 * value of a variable its `env` names or of the policy's `env.allowlist`
 * (review of 0.1.579 B2), or an incomplete `--test-shard` set.
 */

/** Why `entry`'s files are left out, by the processes that belong to it: Node, variables, shards. */
export function entryRefusal(entry: NodeTestEntryHere, parts: readonly NamedPart[]): string | null {
  const project = `project ${JSON.stringify(entry.name)}`;
  const runs = parts.map((p) => p.part.header.nodeTest as PartNodeTest);
  if (entry.node === null) return `${project}: its Node does not run here`;
  const { version, nodeBuild } = entry.node;
  const other = runs.find((run) => run.version !== version);
  if (other !== undefined) {
    return `node:test ran on Node ${other.version}; ${project} runs ${version} here`;
  }
  if (runs.some((run) => run.nodeBuild !== nodeBuild)) {
    return `node:test ran on another build of Node ${version} than ${project} runs here`;
  }
  const variables = Object.keys(entry.env)
    .sort(compare)
    .filter((name) =>
      runs.some((run) => ownValue(run.env, name) !== configFieldHash(entry.env[name])),
    );
  if (variables.length > 0) {
    return `node:test ran with another value of ${variables.join(", ")} than ${project} sets`;
  }
  return allowlistRefusal(project, entry, runs) ?? shardsRefusal(project, parts);
}

/**
 * B2: the variables of `env.allowlist` the entry does not set must have
 * had, in every process, the value this job's environment gives the keys;
 * a part that does not say (made before, or by a checkout of another
 * allowlist) leaves the entry out. Named, never shown.
 */
function allowlistRefusal(
  project: string,
  entry: NodeTestEntryHere,
  runs: readonly PartNodeTest[],
): string | null {
  const names = Object.keys(entry.allowlisted).sort(compare);
  const unknown = names.filter((name) => runs.some((run) => !Object.hasOwn(run.env, name)));
  if (unknown.length > 0) {
    return `the node:test parts of ${project} do not say what ${unknown.join(", ")} held`;
  }
  const other = names.filter((name) =>
    runs.some((run) => ownValue(run.env, name) !== entry.allowlisted[name]),
  );
  if (other.length === 0) return null;
  return `node:test of ${project} ran with another value of ${other.join(", ")} than this job's environment`;
}

/** D26.4: the processes of one entry are each shard of one `--test-shard` count, once; `null` when so. */
function shardsRefusal(project: string, parts: readonly NamedPart[]): string | null {
  const counts = [...new Set(parts.map((p) => p.part.header.shard.count))].sort((a, b) => a - b);
  if (counts.length > 1) return `${project} ran in runs of ${counts.join(", ")} shards`;
  const count = counts[0] as number;
  const indices = parts.map((p) => p.part.header.shard.index);
  const outside = indices.find((index) => index < 1 || index > count);
  if (outside !== undefined) return `${project} names shard ${outside}/${count}`;
  const twice = indices.find((index, at) => indices.indexOf(index) !== at);
  if (twice !== undefined) return `${project} has two parts of shard ${twice}/${count}`;
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter(
    (i) => !indices.includes(i),
  );
  if (missing.length === 0) return null;
  return `${project} has no part of shard ${missing.map((i) => `${i}/${count}`).join(", ")}`;
}
