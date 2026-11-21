import { basename, dirname } from "node:path";
import { commitIdentity, IDENTITY_FAILED } from "../checkout/commit-identity.js";
import { cacheCheckoutsRoot, gitCheckoutsDir } from "../checkout/location.js";
import { type CheckoutMarker, ownerOf } from "../checkout/marker.js";
import { cacheRepositoryDirs, type ListedCheckout, listCheckouts } from "../checkout/sweep.js";
import { shellWord } from "../text.js";
import type { PsPlaces } from "./model.js";
import type { PsCheckout, PsFlag } from "./shape.js";

/*
 * Spec 023 D6 (row 023-05): the temporary checkouts `squeal ps` lists, with
 * their owner's pid and age, and a `dead-checkout` flag on each whose owner
 * is gone. It reads the markers and the owners' `/proc` entries; it writes
 * nothing and removes nothing. The cache holds the checkouts of every
 * repository; the git folder's are read for the current repository only.
 */

/** The checkouts under the cache and the current repository's git folder; `repo` keeps the current one's. */
export function readCheckouts(places: PsPlaces, repo: boolean): PsCheckout[] {
  const cacheRoot =
    places.checkoutsRoot ??
    cacheCheckoutsRoot({ HOME: places.home, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME });
  const dirs = cacheRepositoryDirs(cacheRoot);
  if (places.commonDir !== null) dirs.push(gitCheckoutsDir(places.commonDir));
  return listCheckouts(dirs)
    .filter((c) => !repo || (c.marker !== null && c.marker.commonDir === places.commonDir))
    .map(shapeOf);
}

function shapeOf(listed: ListedCheckout): PsCheckout {
  const { marker, owner } = listed;
  const dead = owner === "dead" && marker !== null;
  return {
    path: listed.tree,
    folder: listed.folder,
    commit: marker?.commit ?? null,
    commonDir: marker?.commonDir ?? null,
    pid: marker === null ? null : ownerOf(marker).pid,
    createdAt: marker?.createdAt ?? null,
    ...(marker?.fingerprint === undefined
      ? {}
      : { kind: "commit" as const, daemon: marker.daemon !== undefined }),
    owner,
    flags: dead ? [deadFlag(listed, marker)] : [],
  };
}

/**
 * Review wave-23 N1: a commit worktree's folder is never given `rm -rf`.
 * One Squeal made goes through `squeal stop --at`, which removes only what
 * Squeal made; any other (its tree fails the identity check, or a removal
 * kept files Squeal did not make) gets no command, only the sweep's words.
 */
function deadFlag(listed: ListedCheckout, marker: CheckoutMarker): PsFlag {
  const reason = `its owner, pid ${ownerOf(marker).pid}, is gone`;
  if (marker.fingerprint === undefined)
    return { flag: "dead-checkout", reason, command: removal(marker.commonDir, listed) };
  if (commitIdentity(listed.tree) === null)
    return { flag: "dead-checkout", reason: `${reason}; ${IDENTITY_FAILED}`, command: null };
  const repo = basename(marker.commonDir) === ".git" ? dirname(marker.commonDir) : listed.tree;
  const command = `cd ${shellWord(repo)} && squeal stop --at ${marker.commit}`;
  return { flag: "dead-checkout", reason, command };
}

/** What `removeTree` does, as shell commands. */
function removal(commonDir: string, listed: ListedCheckout): string {
  const git = `git -C ${shellWord(commonDir)} worktree`;
  return [
    `${git} unlock ${shellWord(listed.tree)}`,
    `${git} remove --force ${shellWord(listed.tree)}`,
    `rm -rf ${shellWord(listed.folder)}`,
  ].join("; ");
}
