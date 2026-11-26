/*
 * Spec 027 D4 (row 027-04): the container targets a repository declares in
 * `squeal.config.json`. A declaration grants nothing: Squeal runs a target
 * only when the user allows it in their own `containers.json`
 * (`src/core/runner-host/container/consent.ts`).
 */

/**
 * Spec 027 D7: how a target's results are keyed. `"build-content"`, the
 * default (the human, 2026-11-26), hashes `dockerfileInputs` so separate
 * `docker build` runs of the same inputs share results; `"image-id"` pins
 * the local image ID.
 */
export type ContainerKeyMode = "build-content" | "image-id";

/** One named container target, with every default applied. */
export interface ContainerTarget {
  /** The local image name or tag. Squeal inspects it, never builds or pulls it. */
  readonly image: string;
  /** The Docker network; may hold `{composeProject}`, which the user's consent sets. Absent: Docker's default. */
  readonly network?: string;
  /** An absolute POSIX path inside the container. Absent: the image's own. */
  readonly workdir?: string;
  /** Default `"build-content"`. */
  readonly keyMode: ContainerKeyMode;
  /** Repository-relative files the `"build-content"` key hashes. Default `[]`. */
  readonly dockerfileInputs: readonly string[];
  /** Compose service names whose image IDs join the key when they run. Default `[]`. */
  readonly dependencyServices: readonly string[];
  /** Extra non-secret variables passed into the container. Default `{}`. */
  readonly env: Readonly<Record<string, string>>;
}

/** The defaults a declared target takes for each key it leaves out. */
export const CONTAINER_TARGET_DEFAULTS = {
  keyMode: "build-content",
  dockerfileInputs: [],
  dependencyServices: [],
  env: {},
} as const satisfies Partial<ContainerTarget>;
