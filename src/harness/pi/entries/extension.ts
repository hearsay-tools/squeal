import { Worker } from "node:worker_threads";
import { squealExtension } from "../extension.js";

/*
 * The Pi package's extension (spec 009 D1), bundled as `dist/extension.mjs`.
 * Its delivery worker is the sibling `dist/worker.mjs`. Its stderr is Pi's, so
 * the worker runs with `node:sqlite`'s ExperimentalWarning off: Node 22 prints
 * it when the store is first opened, into Pi's terminal (D4).
 */
export default squealExtension(
  () =>
    new Worker(new URL("./worker.mjs", import.meta.url), {
      execArgv: ["--disable-warning=ExperimentalWarning"],
    }),
);
