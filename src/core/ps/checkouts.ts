import { cacheCheckoutsRoot, gitCheckoutsDir } from "../checkout/location.js";
import { cacheRepositoryDirs, type ListedCheckout, listCheckouts } from "../checkout/sweep.js";
import { shellWord } from "../text.js";
import type { PsPlaces } from "./model.js";
import type { PsCheckout } from "./shape.js";

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
    pid: marker?.owner.pid ?? null,
    createdAt: marker?.createdAt ?? null,
    owner,
    flags: dead
      ? [
          {
            flag: "dead-checkout",
            reason: `its owner, pid ${marker.owner.pid}, is gone`,
            command: removal(marker.commonDir, listed),
          },
        ]
      : [],
  };
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
