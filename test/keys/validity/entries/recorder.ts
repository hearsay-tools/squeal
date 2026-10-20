/*
 * The shared recorder's entries (011 C12, task 011-37 section 2), under
 * `RECORDER_VERSION`: `src/runners/observe/*.ts`, all of which `index.ts`
 * re-exports, reading and classifying the observations; the CommonJS that
 * records them inside test processes is compared as text (`components.ts`).
 */

export * as observe from "../../../../src/runners/observe/index.js";
