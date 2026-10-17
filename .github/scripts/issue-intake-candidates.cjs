"use strict";

// Duplicate candidates for issue intake, built in code so Jev can never pick
// the new issue itself, the issue it was split out of, or an epic, which
// tracks child issues and is never their duplicate. Spec 010 D12, ported from
// hearsay-tools/cezarion at 10cec2e9. Candidates are the open issues plus the
// issues closed in the last 30 days; `open` tells the applicator whether a
// duplicate pick may close the new issue or only comment on it. The Jev job
// reads the list this writes; the applicator rebuilds it uncapped.

const fs = require("node:fs");

// A Jev Choice takes at most 255 options, and one of them is "none".
const MAX_CANDIDATES = 254;
const CLOSED_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const EPIC = "epic";

const REF = String.raw`\[?(?:#(\d+)|([\w.-]+\/[\w.-]+)#(\d+)|https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+))`;
const SPLIT_OUT = new RegExp(
  String.raw`\b(?:split|carved)(?:\s+out)?\s+(?:of|from)\s+${REF}`,
  "gi",
);

function splitParents(body, repo, title = "") {
  const parents = new Set();
  const here = String(repo).toLowerCase();
  for (const text of [title, body]) {
    if (typeof text !== "string") continue;
    for (const match of text.matchAll(SPLIT_OUT)) {
      const [, bare, refRepo, refNumber, urlRepo, urlNumber] = match;
      if (bare) parents.add(Number(bare));
      else if (refRepo && refRepo.toLowerCase() === here) parents.add(Number(refNumber));
      else if (urlRepo && urlRepo.toLowerCase() === here) parents.add(Number(urlNumber));
    }
  }
  return parents;
}

function labelName(label) {
  return typeof label === "string" ? label : label?.name;
}

// The earliest close time a closed issue may have and still be a candidate.
function closedSince(now) {
  return new Date(new Date(now).getTime() - CLOSED_WINDOW_DAYS * DAY_MS).toISOString();
}

function toCandidate(other, open) {
  return {
    number: other.number,
    title: String(other.title ?? ""),
    body: String(other.body ?? ""),
    labels: (other.labels ?? [])
      .map(labelName)
      .filter((name) => typeof name === "string" && name.length > 0),
    updated_at: other.updated_at ?? null,
    open,
  };
}

function buildCandidates({
  issue,
  openIssues,
  closedIssues = [],
  repo,
  now = new Date(),
  max = MAX_CANDIDATES,
}) {
  if (!issue || !Number.isInteger(issue.number) || issue.number <= 0)
    throw new Error("issue number must be a positive integer.");
  if (!Array.isArray(openIssues)) throw new Error("openIssues must be an array.");
  if (!Array.isArray(closedIssues)) throw new Error("closedIssues must be an array.");
  if (typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error("repo must be owner/name.");
  if (Number.isNaN(new Date(now).getTime())) throw new Error("now must be a date.");

  const excluded = splitParents(issue.body, repo, issue.title);
  excluded.add(issue.number);
  const since = closedSince(now);
  const usable = (other) =>
    other && !other.pull_request && Number.isInteger(other.number) && !excluded.has(other.number);

  const open = openIssues.filter(usable).map((other) => toCandidate(other, true));
  const openNumbers = new Set(open.map((candidate) => candidate.number));
  const closed = closedIssues
    .filter((other) => usable(other) && !openNumbers.has(other.number))
    .filter((other) => typeof other.closed_at === "string" && other.closed_at >= since)
    .map((other) => toCandidate(other, false));

  const candidates = [...open, ...closed].filter((candidate) => !candidate.labels.includes(EPIC));
  if (candidates.length <= max) return candidates;

  const keep = new Set(
    [...candidates]
      .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))
      .slice(0, max)
      .map((candidate) => candidate.number),
  );
  return candidates.filter((candidate) => keep.has(candidate.number));
}

// node issue-intake-candidates.cjs <issue.json> <open-raw.json> <closed-raw.json>
// prints the filtered candidates. GITHUB_REPOSITORY names the repository.
if (require.main === module) {
  const [issuePath, openPath, closedPath] = process.argv.slice(2);
  const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  const candidates = buildCandidates({
    issue: read(issuePath),
    openIssues: read(openPath),
    closedIssues: read(closedPath),
    repo: process.env.GITHUB_REPOSITORY,
  });
  process.stdout.write(`${JSON.stringify(candidates)}\n`);
}

module.exports = {
  buildCandidates,
  splitParents,
  closedSince,
  MAX_CANDIDATES,
  CLOSED_WINDOW_DAYS,
};
