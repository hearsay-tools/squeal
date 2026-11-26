import { isRecord } from "../../core/fs/json.js";
import type { ContainerConsent } from "../../core/runner-host/container/consent.js";
import type { ContainerTarget } from "../../core/types/policy-containers.js";

/*
 * Spec 027 D4 (row 027-04): what `squeal setup` shows and writes for the
 * container targets a repository's `squeal.config.json` declares. The
 * declaration grants nothing; consent is an entry in the user's own
 * `containers.json`, written only after the user opts in.
 */

/** Why allowing containers is a decision for the user, as setup states it. */
export const CONTAINER_RISK =
  "Allowing containers lets Squeal run docker for this repository. Access to the Docker socket is root-equivalent on this host: whoever can use it can act as root here. Allow it only for a repository you trust.";

/**
 * The warning setup shows before it asks: the risk, then each declared
 * target with its image and network. `null` when the repository declares none.
 */
export function containerConsentWarning(
  targets: Readonly<Record<string, ContainerTarget>>,
  settingsPath: string,
): string | null {
  const names = Object.keys(targets);
  if (names.length === 0) return null;
  const lines = names.map((name) => {
    const { image, network } = targets[name] as ContainerTarget;
    const joins = network === undefined ? "Docker's default network" : `network ${network}`;
    return `  - ${name}: image ${image}, ${joins}`;
  });
  return [
    "squeal.config.json declares container targets:",
    ...lines,
    CONTAINER_RISK,
    `Squeal runs none of them until you allow them in ${settingsPath}.`,
  ].join("\n");
}

/** The user's answer to setup's container question. */
export interface ContainerOptIn {
  /** `true` only when the user answered yes; nothing else enables consent. */
  readonly optIn: boolean;
  /** The targets the user allows. */
  readonly targets: readonly string[];
  readonly composeProject?: string;
  readonly networkOverride?: string;
}

/** The consent entry for `answer`, or `null` when the user did not opt in or allowed no target. */
export function containerConsentEntry(answer: ContainerOptIn): ContainerConsent | null {
  if (answer.optIn !== true || answer.targets.length === 0) return null;
  return {
    enabled: true,
    targets: [...answer.targets],
    ...(answer.composeProject === undefined ? {} : { composeProject: answer.composeProject }),
    ...(answer.networkOverride === undefined ? {} : { networkOverride: answer.networkOverride }),
  };
}

/**
 * The text of `containers.json` with `entry` under `repositoryKey` in
 * `allow`, every other key and entry kept. `current` is the file's text,
 * `null` when it is missing. Throws when the text is not a JSON object, so
 * setup never overwrites a file it cannot read.
 */
export function withConsentEntry(
  current: string | null,
  repositoryKey: string,
  entry: ContainerConsent,
): string {
  const parsed: unknown = current === null ? {} : JSON.parse(current);
  if (!isRecord(parsed)) throw new Error("containers.json must hold a JSON object");
  const allow = isRecord(parsed.allow) ? parsed.allow : {};
  const next = { ...parsed, allow: { ...allow, [repositoryKey]: entry } };
  return `${JSON.stringify(next, null, 2)}\n`;
}
