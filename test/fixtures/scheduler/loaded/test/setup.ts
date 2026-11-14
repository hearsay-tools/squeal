import { helper } from "../src/setup-helper.js";

(globalThis as { helped?: number }).helped = helper();
