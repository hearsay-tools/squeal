import { createJestAdapter, JEST_ADAPTER_VERSION } from "./adapter.js";
import { jestTraits } from "./traits.js";

/*
 * Spec 028 (row 028-05): the Jest runner the daemon and a runner host build.
 * Bindings, not `export ... from`, as Biome's `noBarrelFile` asks.
 */
export type { JestAdapterOptions } from "./adapter.js";
export { createJestAdapter, JEST_ADAPTER_VERSION, jestTraits };
