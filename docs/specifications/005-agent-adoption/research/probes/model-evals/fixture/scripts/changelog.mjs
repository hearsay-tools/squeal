#!/usr/bin/env node
// Renders CHANGELOG.md sections from changes.json: `npm run changelog [version]`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LABEL = { feature: "Added", fix: "Fixed" };

/** One release's section: entries grouped by type, in the order the types first appear. */
export function renderRelease(version, entries) {
  const groups = new Map();
  for (const entry of entries) {
    const label = LABEL[entry.type] ?? "Changed";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(entry.text);
  }
  const out = [`## ${version}`];
  for (const [label, texts] of groups) {
    out.push("", `### ${label}`, "", ...texts.map((text) => `- ${text}`));
  }
  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const changes = JSON.parse(readFileSync(new URL("../changes.json", import.meta.url), "utf8"));
  const version = process.argv[2] ?? "unreleased";
  console.log(renderRelease(version === "unreleased" ? "Unreleased" : version, changes[version] ?? []));
}
