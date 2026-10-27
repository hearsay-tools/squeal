import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { selectionFile } from "../../../../src/harness/codex/adapter/selection.js";

// A real process pauses inside selection exclusion until released or killed.
const data = process.argv[2];
if (!data) throw new Error("selection-owner needs data");
mkdirSync(dirname(selectionFile(data)), { recursive: true });
const db = new DatabaseSync(selectionFile(data));
db.exec("BEGIN EXCLUSIVE");
process.on("message", (message) => {
  if (message !== "release") return;
  db.close();
  process.disconnect();
});
process.send?.("held");
