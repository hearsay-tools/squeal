import { Worker } from "node:worker_threads";
import { squealExtension } from "../extension.js";

/*
 * The Pi package's extension (spec 009 D1), bundled as `dist/extension.mjs`.
 * Its delivery worker is the sibling `dist/worker.mjs`.
 */
export default squealExtension(() => new Worker(new URL("./worker.mjs", import.meta.url)));
