import { isRecord } from "../fs/json.js";
import type { Policy } from "../types/policy.js";
import {
  CONTAINER_TARGET_DEFAULTS,
  type ContainerKeyMode,
  type ContainerTarget,
} from "../types/policy-containers.js";
import type { Kept } from "./config-file.js";
import { type Field, insideRoot, variables } from "./policy-node-test.js";
import { commandName } from "./policy-remote.js";

/*
 * Spec 027 D4 (row 027-04): the `containers` key of the policy loader, and
 * the check that each project's `container` names a declared target. Under
 * 001 D11: a bad target is one problem and is left out, the others are kept;
 * a project that names a target `containers` does not hold is one problem
 * and is skipped, so it never runs on the host in its target's place.
 */

/** A value Docker reads as one argument: no space or control character, no leading `-`. */
export function dockerToken(value: unknown): boolean {
  return typeof value === "string" && /^[^-\s]\S*$/.test(value) && !/\p{Cc}/u.test(value);
}

const token =
  (what: string): Field =>
  (v) =>
    dockerToken(v) ? null : `${what} with no space, control character or leading "-"`;

const KEY_MODES: readonly ContainerKeyMode[] = ["build-content", "image-id"];

const keyMode: Field = (v) =>
  KEY_MODES.includes(v as ContainerKeyMode) ? null : '"build-content" or "image-id"';

/** D4: an absolute path inside the container. */
const workdir: Field = (v) =>
  typeof v === "string" && v.startsWith("/") && !/\p{Cc}/u.test(v)
    ? null
    : "an absolute POSIX path such as /app";

const listOf =
  (what: string, each: (entry: unknown) => boolean): Field =>
  (v) =>
    Array.isArray(v) && v.every(each) ? null : `an array of ${what}`;

/** D4: a repository-relative path, never absolute and never above the root. */
const repositoryPath = (v: unknown): boolean =>
  typeof v === "string" && v !== "" && !v.startsWith("\\") && insideRoot(v) === null;

/** Every key of `ContainerTarget`; `image` is required. */
const FIELDS: Readonly<Record<keyof ContainerTarget, Field>> = {
  image: token("an image name"),
  network: token("a network name"),
  workdir,
  keyMode,
  dockerfileInputs: listOf("repository-relative paths", repositoryPath),
  dependencyServices: listOf("service names", dockerToken),
  env: variables,
};

/** Why `entry` is not a target, or `null`. */
function targetProblem(entry: unknown): string | null {
  if (!isRecord(entry)) return `must be an object, got ${JSON.stringify(entry)}`;
  const unknown = Object.keys(entry).find((key) => !Object.hasOwn(FIELDS, key));
  if (unknown !== undefined) return `has unknown key "${unknown}"`;
  if (entry.image === undefined) return 'has no "image"';
  for (const [key, field] of Object.entries(FIELDS)) {
    const given = entry[key];
    if (given === undefined) continue;
    const expected = field(given);
    if (expected !== null) {
      const why = typeof expected === "object" ? expected.problem : `must be ${expected}`;
      return `"${key}" ${why}, got ${JSON.stringify(given)}`;
    }
  }
  return null;
}

/** The `containers` rule: from a target name to a target; a bad name or target is left out. */
export function containerTargets(value: unknown): string | Kept {
  if (!isRecord(value)) return "an object from target name to a container target";
  const kept: Record<string, ContainerTarget> = {};
  const problems: string[] = [];
  for (const [name, entry] of Object.entries(value)) {
    const problem = commandName(name)
      ? targetProblem(entry)
      : 'has a name with a space, "/", "\\", control character or leading "-"';
    if (problem === null) {
      kept[name] = {
        ...CONTAINER_TARGET_DEFAULTS,
        ...(entry as Partial<ContainerTarget>),
      } as ContainerTarget;
    } else problems.push(`"containers.${name}" ${problem}; it is left out`);
  }
  return { kept, problems };
}

/** The runner lists whose projects may name a `container`. */
const RUNNER_LISTS = ["nodeTest", "pytest"] as const;

/**
 * D4: each project that names a `container` `containers` does not hold is
 * skipped with one problem. Returns `policy` itself when none does.
 */
export function settleContainers(policy: Policy): {
  readonly policy: Policy;
  readonly problems: readonly string[];
} {
  const problems: string[] = [];
  let settled = policy;
  for (const list of RUNNER_LISTS) {
    const projects: readonly { readonly name: string; readonly container?: string }[] =
      policy[list];
    const kept = projects.filter((project) => {
      const { container } = project;
      if (container === undefined || Object.hasOwn(policy.containers, container)) return true;
      problems.push(
        `"${list}" project ${JSON.stringify(project.name)} names container ${JSON.stringify(container)}, which "containers" does not declare; it is skipped`,
      );
      return false;
    });
    if (kept.length !== projects.length) settled = { ...settled, [list]: kept };
  }
  return { policy: settled, problems };
}
