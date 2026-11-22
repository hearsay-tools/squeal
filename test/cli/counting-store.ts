import type { createStore as CreateStore } from "../../src/core/store/store.js";
import type { Store } from "../../src/core/types/store.js";

/*
 * Task 011-42: a counting store, for tests of what a wait's poll reads. A
 * test file mocks `src/core/store/store.js` with `counting(original.createStore)`,
 * which both `openStore` and status's read-only open (spec 024 D2) call;
 * each store opened then logs, in order, its reads of known states, every
 * one (`states`) or by test file (`file-states`), and of a checkpoint.
 */

export type StoreRead = "states" | "file-states" | "checkpoint";

/** Each store opened since the test last emptied it, with its reads. */
export const sessions: { readonly reads: StoreRead[] }[] = [];

export function counting(createStore: typeof CreateStore): typeof CreateStore {
  return (conn, schemaVersion, paths) => {
    const opened = createStore(conn, schemaVersion, paths);
    const reads: StoreRead[] = [];
    sessions.push({ reads });
    const store = opened as { -readonly [K in keyof Store]: Store[K] };
    const { knownStates, checkpoints } = store;
    store.knownStates = {
      ...knownStates,
      list: (id, files) => {
        reads.push(files === undefined ? "states" : "file-states");
        return knownStates.list(id, files);
      },
    };
    store.checkpoints = {
      ...checkpoints,
      get: (id) => {
        reads.push("checkpoint");
        return checkpoints.get(id);
      },
    };
    return store;
  };
}
