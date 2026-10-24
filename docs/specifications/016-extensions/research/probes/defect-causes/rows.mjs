// Throwaway probe for 016-09: list board rows (board.md and 001's archive) with their section,
// and flag those that repair a defect. Usage: node rows.mjs <repo-root>  -> JSON lines.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
const files = ["docs/board.md", "docs/specifications/001-core-loop/board-archive.md"];
const REVIEW = /reviews\/|review (fix|repair)|repairs? of|\bB\d\b|blocker/i;
const DOGFOOD = /dogfood|lessons\.md|lessons|found during|live session|friction/i;
const DEFECT = /\b(fix|fixes|repair|defect|regression|bug|broken|false pass|stale pass|wrong|leak|crash|hang|race|loses?|lost)\b/i;
let section = "";
for (const f of files) {
  for (const line of readFileSync(join(root, f), "utf8").split("\n")) {
    const h = line.match(/^#{2,3} (.*)/);
    if (h) { section = h[1]; continue; }
    if (!line.startsWith("| ") || /^\| (Task|Key|Row)\b/.test(line) || /^\| -/.test(line)) continue;
    const cells = line.split(" | ");
    const head = cells[0].slice(2);
    const id = (head.match(/^(gh-\d+|\d{3}-\d+[a-z]?|[A-Z][\w-]*)/) || [""])[0];
    const status = cells[1] ?? "";
    const text = line;
    const origin = /^gh-/.test(id) || /^Triage/.test(section) ? "issue"
      : /^Later/.test(section) ? "later"
      : REVIEW.test(head + " " + section) || REVIEW.test(cells[2] ?? "") && /fix|repair/i.test(head + section) ? "review-repair"
      : DOGFOOD.test(head + " " + section) ? "dogfood"
      : DEFECT.test(head) ? "defect" : "feature";
    console.log(JSON.stringify({ file: f, section, id, head: head.slice(0, 160), status: status.slice(0, 60), origin, text: text.slice(0, 900) }));
  }
}
