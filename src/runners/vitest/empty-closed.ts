import type { Vitest } from "vitest/node";

/*
 * Task 013-06 (research `vitest-close-leak.md` 3a, the `noplugins` break):
 * Rolldown's native resolve plugin holds Vite 8's callbacks as GC roots, and
 * their closures reach the config's plugins, whose hooks close over the
 * instance, so every closed `Vitest` stays reachable with all it held.
 * Emptying the closed instance leaves the roots holding empty shells.
 */

/**
 * Gathers what `vitest` holds (`closedTargets`), awaits its close, then
 * empties each target (`emptyClosed`). The targets are gathered first: the
 * close clears `vitest.vite` when no project in `vitest.projects` is the core
 * one, as with a root config that selects only separate project configs. The
 * close's error is the caller's, and leaves every target as it is. An error
 * while gathering or emptying is dropped: a shape this does not know frees
 * less, and fails nothing. Never for an instance whose close may still run
 * (`abandon`).
 */
export async function closeEmptied(vitest: Vitest): Promise<void> {
  const targets = await Promise.resolve(vitest)
    .then(closedTargets)
    .catch(() => []);
  await vitest.close();
  await Promise.resolve(targets)
    .then(emptyClosed)
    .catch(() => 0);
}

/**
 * `vitest`, its logger, its projects with the core one, its Vite servers (the
 * root one and each project's) and their environments. Plugin objects are
 * left out: a config may import a ready-made one, which the next instance
 * shares.
 */
export function closedTargets(vitest: Vitest): object[] {
  const listed = Array.isArray(vitest.projects) ? vitest.projects : [];
  const projects = new Set([vitest.getRootProject(), ...listed]);
  const servers = new Set([vitest.vite, ...[...projects].map((project) => project.vite)]);
  const environments = [...servers].flatMap((server) => Object.values(server?.environments ?? {}));
  const targets: unknown[] = [...environments, ...servers, ...projects, vitest.logger, vitest];
  return [...new Set(targets)].filter((t): t is object => typeof t === "object" && t !== null);
}

/** Deletes the own properties of each of `targets`, and returns how many it emptied. */
export function emptyClosed(targets: readonly object[]): number {
  for (const target of targets) {
    for (const key of Reflect.ownKeys(target)) Reflect.deleteProperty(target, key);
  }
  return targets.length;
}
