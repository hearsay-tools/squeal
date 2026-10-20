/*
 * The pytest adapter's entries (011 C14, task 011-37 section 2), under
 * `PYTEST_ADAPTER_VERSION`: the adapter and what it imports; its Python
 * runtime is compared as text (`components.ts`). `src/core/daemon/pytest-runners.ts`
 * is left out.
 */

export * as adapter from "../../../../src/runners/pytest/adapter.js";
