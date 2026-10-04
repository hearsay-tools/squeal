import { notImplemented } from "../not-implemented.js";
import type { AbsolutePath, Store } from "../types/index.js";

/** Opens `<git-common-dir>/squeal/store.sqlite` (spec 001 D1, D8). Task 001-10. */
export function openStore(_commonDir: AbsolutePath): Store {
  return notImplemented("openStore");
}
