import { importFiles, listImports } from "../store/imports.js";
import type { ProjectName } from "../types/common.js";
import type { Store } from "../types/store.js";

/*
 * Row 018-28 (`research/shared-proof.md` Q2): an import into a running
 * daemon's store, by the reader or by `squeal import`, adds observed entries
 * the daemon's keys have not read, so its files stayed at their old keys
 * until a restart. The daemon reads them again for the projects of each
 * import it has not seen, as its start does. Both import paths tell the
 * daemon through its retry request, which asks this.
 */

export class ImportsSeen {
  /** The imports the daemon's keys read: those before its start, and each one taken since. */
  readonly #seen: Set<string>;

  /** Before the daemon's start keys its files: an import from here on is new. */
  constructor(private readonly store: Store) {
    this.#seen = new Set(listImports(store).map((i) => i.id));
  }

  /**
   * Hands `reread` the projects of the imports not seen yet, and their ids,
   * and sees them when it takes them; when it answers false or throws, the
   * next call hands them again. While `reread` runs they count as seen, so
   * a call meanwhile does not hand them twice (row 011-323: the scheduler's
   * request waits for the lock and for a busy store).
   */
  async take(
    reread: (projects: readonly ProjectName[], imports: readonly string[]) => Promise<boolean>,
  ): Promise<void> {
    const fresh = listImports(this.store).filter((i) => !this.#seen.has(i.id));
    if (fresh.length === 0) return;
    const projects = new Set(
      fresh.flatMap((i) => importFiles(this.store, i.id).map((f) => f.project)),
    );
    const ids = fresh.map((i) => i.id);
    for (const id of ids) this.#seen.add(id);
    let taken = false;
    try {
      taken = projects.size === 0 || (await reread([...projects].sort(), ids));
    } finally {
      if (!taken) for (const id of ids) this.#seen.delete(id);
    }
  }
}
