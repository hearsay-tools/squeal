// Throwaway probe (016-03 Q3). Two Biome SARIF runs of one file, before and
// after a comment line is added above the code. Which identities of a
// diagnostic survive the unrelated edit?
// Usage: node diag-identity.mjs <before.sarif> <before-source> <after.sarif> <after-source>
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [beforeSarif, beforeSrc, afterSarif, afterSrc] = process.argv.slice(2);

function read(sarifPath, srcPath) {
  const lines = readFileSync(srcPath, "utf8").split("\n");
  const seen = new Map();
  return JSON.parse(readFileSync(sarifPath, "utf8")).runs[0].results.map((r) => {
    const region = r.locations[0].physicalLocation.region;
    const lineText = lines[region.startLine - 1].replace(/\s+/g, "");
    // Squeal's test fingerprint today: "<name>: <message> @ <path>:<line>:<column>" (src/core/state/fingerprint.ts).
    const located = `${r.ruleId}: ${r.message.text} @ a.ts:${region.startLine}:${region.startColumn}`;
    // GitHub-style: the rule, the message and a hash of the line's text with whitespace removed, plus an occurrence index.
    const base = `${r.ruleId}|${r.message.text}|${createHash("sha256").update(lineText).digest("hex").slice(0, 16)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { rule: r.ruleId, located, content: `${base}:${n}` };
  });
}

const before = read(beforeSarif, beforeSrc);
const after = read(afterSarif, afterSrc);
for (const b of before) {
  const a = after.find((x) => x.rule === b.rule);
  console.log(
    JSON.stringify({
      rule: b.rule,
      locatedSame: a?.located === b.located,
      contentSame: a?.content === b.content,
      before: b.located,
      after: a?.located,
    }),
  );
}
