// Vitest 4.1.10's `vitest/node` at run time, cut down for row 018-26: it
// imports the `Vitest` class from a chunk for its `version` and exports
// neither that class nor a `Logger`.
import { V as Vitest } from "./chunks/cli-api.js";
export { c as createVitest, s as startVitest } from "./chunks/cli-api.js";

const version = Vitest.version;

export { version };
