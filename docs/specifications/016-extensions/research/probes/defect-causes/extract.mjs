// Throwaway probe for 016-09: list every review file's verdict and its blocker and should-fix items.
// Usage: node extract.mjs <repo-root>  -> JSON lines on stdout.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.argv[2];
const specs = join(root, "docs/specifications");
const out = [];
for (const spec of readdirSync(specs).filter((d) => /^\d{3}-/.test(d)).sort()) {
  let files;
  try { files = readdirSync(join(specs, spec, "reviews")); } catch { continue; }
  for (const f of files.filter((n) => n.endsWith(".md") && n !== "README.md").sort()) {
    const rel = `docs/specifications/${spec}/reviews/${f}`;
    const text = readFileSync(join(root, rel), "utf8");
    const lines = text.split("\n");
    const date = execFileSync("git", ["-C", root, "log", "--diff-filter=A", "--format=%as", "--", rel], { encoding: "utf8" }).trim().split("\n").pop();
    let verdict = "?";
    const vAt = lines.findIndex((l) => /^#{1,3} .*verdict/i.test(l));
    if (vAt >= 0) {
      const after = lines.slice(vAt, vAt + 6).join(" ");
      const m = after.match(/\b(PASS|FAIL)\b/);
      if (m) verdict = m[1];
    }
    if (verdict === "?") for (const l of lines.slice(0, 40)) {
      if (/->|→/.test(l)) continue;
      const m = l.match(/\b(PASS|FAIL)\b/);
      if (m) { verdict = m[1]; break; }
    }
    // Sections are "## Blockers", "## Should-fix" and mixed forms. An item is a "### " heading;
    // a section without any "### " heading lists its items as top-level bullets instead.
    const sections = [];
    let cur = null;
    for (const l of lines) {
      const h = l.match(/^## (.*)/);
      if (h) {
        const t = h[1];
        const kind = /blocker/i.test(t) ? (/should/i.test(t) ? "mixed" : "blocker") : /should-?fix/i.test(t) ? "should" : null;
        cur = kind ? { kind, lines: [] } : null;
        if (cur) sections.push(cur);
        continue;
      }
      if (cur) cur.lines.push(l);
    }
    const items = [];
    for (const sec of sections) {
      const heads = sec.lines.some((l) => /^### /.test(l));
      const isItem = heads ? (l) => l.match(/^### (.*)/) : (l) => l.match(/^(?:- |\d+\. )(.{15,})/);
      for (let i = 0; i < sec.lines.length; i++) {
        const m = isItem(sec.lines[i]);
        if (!m) continue;
        const title = m[1];
        if (/^(none|no )\b/i.test(title)) continue;
        let kind = sec.kind;
        if (kind === "mixed") kind = /^\W*(B\d|blocker)/i.test(title) ? "blocker" : /^\W*(N\d|nit)/i.test(title) ? "nit" : "should";
        if (kind === "nit" || /^\W*N\d/.test(title)) continue;
        const body = [];
        for (let j = i + 1; j < sec.lines.length && body.length < 14; j++) {
          if (isItem(sec.lines[j])) break;
          body.push(sec.lines[j]);
        }
        items.push({ kind, title: title.slice(0, 300), body: body.join(" ").replace(/\s+/g, " ").slice(0, 900) });
      }
    }
    // Early reviews (001 waves 1 to 6) state no PASS or FAIL; a listed blocker makes them FAIL.
    if (verdict === "?") verdict = items.some((i) => i.kind.startsWith("blocker")) ? "FAIL(implied)" : "none";
    out.push({ spec, file: rel, date, verdict, items });
  }
}
for (const r of out) console.log(JSON.stringify(r));
