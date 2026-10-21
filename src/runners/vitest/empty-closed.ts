import type { Vitest } from "vitest/node";

/*
 * Task 013-06 (research `vitest-close-leak.md` 3a, the `noplugins` break):
 * Rolldown's native resolve plugin holds Vite 8's callbacks as GC roots, and
 * their closures reach the config's plugins, whose hooks close over the
 * instance, so every closed `Vitest` stays reachable with all it held.
 * Emptying the closed instance leaves the roots holding empty shells.
 */

/**
 * Awaits `vitest`'s close, then empties it (`emptyClosed`). The close's
 * error is the caller's, and leaves the instance as it is. An error while
 * emptying is dropped: a shape this does not know frees less, and fails
 * nothing. Never for an instance whose close may still run (`abandon`).
 */
export async function closeEmptied(vitest: Vitest): Promise<void> {
  await vitest.close();
  await Promise.resolve(vitest)
    .then(emptyClosed)
    .catch(() => 0);
}

/**
 * Deletes the own properties of `vitest`, its logger, its projects, its Vite
 * servers (the root one and each project's) and their environments, and
 * returns how many objects it emptied. Plugin objects are left alone: a
 * config may import a ready-made one, which the next instance shares.
 */
export function emptyClosed(vitest: Vitest): number {
  // Everything is gathered before anything is emptied: emptying one hides the others.
  const projects = Array.isArray(vitest.projects) ? vitest.projects : [];
  const servers = new Set([vitest.vite, ...projects.map((project) => project.vite)]);
  const environments = [...servers].flatMap((server) => Object.values(server?.environments ?? {}));
  const emptied = new Set<object>();
  for (const target of [...environments, ...servers, ...projects, vitest.logger, vitest]) {
    if (typeof target !== "object" || target === null || emptied.has(target)) continue;
    emptied.add(target);
    for (const key of Reflect.ownKeys(target)) Reflect.deleteProperty(target, key);
  }
  return emptied.size;
}
