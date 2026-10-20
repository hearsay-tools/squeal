/*
 * The node:test adapter's entries (011 C14, task 011-37 section 2), under
 * `NODE_TEST_ADAPTER_VERSION`: the adapter and what it imports; its runtime
 * files are compared as text (`components.ts`). The composite's slot and
 * width hints (`src/core/daemon/node-test-runners.ts`) are left out.
 */

export * as adapter from "../../../../src/runners/node-test/adapter.js";
