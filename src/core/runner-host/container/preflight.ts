import { statSync } from "node:fs";
import type { RootStat } from "../protocol.js";
import type { DockerCli } from "./docker.js";

/*
 * Spec 027 D5.2 and D6 (row 027-05): what a container must show before
 * Squeal runs a test in it. Its Node is 22.19 or later, as Squeal's own
 * `engines.node`, for `node:sqlite`; a host Node is never mounted in (the
 * human, 2026-11-26). Its root is the host's worktree through a live bind
 * mount, by device and inode, never code baked into the image. Its image
 * is still the one the tag names, or it was rebuilt.
 */

/** The oldest Node a container may run Squeal's runner host with. */
export const MIN_NODE: readonly [number, number, number] = [22, 19, 0];

/** Why Squeal runs nothing in a container target. */
export type ContainerState =
  | "image-missing"
  | "node-too-old"
  | "mount-mismatch"
  | "mount-source-missing"
  | "docker-unreachable"
  | "start-failed";

/** A refusal: the target's files stay unknown, with `note`. */
export interface ContainerRefusal {
  readonly ok: false;
  readonly state: ContainerState;
  readonly note: string;
  /** `node-too-old`: the version the container has, or `none`. */
  readonly found?: string;
}

/** `x.y.z` from `node -p process.versions.node`; `null` when it is no version. */
export function parseNodeVersion(text: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Whether `found` is `MIN_NODE` or later. */
export function nodeAdmitted(found: readonly [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    const [have, need] = [found[i] ?? 0, MIN_NODE[i] ?? 0];
    if (have !== need) return have > need;
  }
  return true;
}

const NODE_MS = 15_000;

/** Node in `containerId` is `MIN_NODE` or later, or the refusal naming what it found. */
export async function checkNode(
  cli: DockerCli,
  containerId: string,
  target: string,
): Promise<{ readonly ok: true; readonly found: string } | ContainerRefusal> {
  const result = await cli
    .execSyncText(containerId, ["node", "-p", "process.versions.node"], NODE_MS)
    .catch(() => null);
  const text = result?.code === 0 ? result.stdout.trim() : "";
  const parsed = parseNodeVersion(text);
  if (parsed !== null && nodeAdmitted(parsed)) return { ok: true, found: parsed.join(".") };
  const found = parsed === null ? "none" : parsed.join(".");
  const need = MIN_NODE.join(".");
  const has = parsed === null ? "has no node on its PATH" : `has Node ${found}`;
  return {
    ok: false,
    state: "node-too-old",
    found,
    note: `container ${target}: its image ${has}; Squeal's runner host needs Node >= ${need} inside the image, so its tests did not run`,
  };
}

/**
 * Whether the root the host reports is `hostRoot` itself: the same device
 * and inode as the daemon's own `statSync`. Missing or unequal is refused.
 */
export function proveMount(
  hostRoot: string,
  rootStat: RootStat | undefined,
  target: string,
): { readonly ok: true } | ContainerRefusal {
  let own: RootStat | null = null;
  try {
    const stat = statSync(hostRoot);
    own = { dev: stat.dev, ino: stat.ino };
  } catch {
    own = null;
  }
  if (own !== null && rootStat !== undefined) {
    if (own.dev === rootStat.dev && own.ino === rootStat.ino) return { ok: true };
  }
  const seen = rootStat === undefined ? "none" : `${rootStat.dev}:${rootStat.ino}`;
  const mine = own === null ? "unreadable" : `${own.dev}:${own.ino}`;
  return {
    ok: false,
    state: "mount-mismatch",
    note: `container ${target}: its ${hostRoot} is device:inode ${seen}, the worktree's is ${mine}; it is not the worktree mounted live, so its tests did not run`,
  };
}

/** Whether the image `image` names is still the one a container runs (`runningImageId`). */
export type ImageCheck =
  | { readonly changed: false; readonly imageId: string }
  | { readonly changed: true; readonly imageId: string }
  | { readonly missing: true };

/** `image`'s current ID against `runningImageId`, the container's `org.squeal.image` label. */
export async function checkImage(
  cli: DockerCli,
  image: string,
  runningImageId: string,
): Promise<ImageCheck> {
  const info = await cli.imageInspect(image);
  if (info === null) return { missing: true };
  return { changed: info.id !== runningImageId, imageId: info.id };
}
