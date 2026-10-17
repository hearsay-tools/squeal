"use strict";

// Replay of Jev issue intake over this repository's issues (spec 010 D12),
// adapted from hearsay-tools/cezarion's at 10cec2e9. It rebuilds the
// candidates each issue would have seen when it was opened, asks Jev once per
// issue, and scores the answers against the human's decisions on the board,
// never against another model: the area of each issue the board routed to a
// spec (`gh-N to NNN-MM`) and the duplicate verdicts below.
//
//   node .github/scripts/jev-intake-replay.cjs fetch  --dir <dir>
//   node .github/scripts/jev-intake-replay.cjs ask    --dir <dir>   (needs TYPESAFE_API_KEY)
//   node .github/scripts/jev-intake-replay.cjs report --dir <dir> --board docs/board.md --out <report.md>
//
// fetch and ask write only into --dir; keep it out of git (issue bodies).

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { buildCandidates } = require("./issue-intake-candidates.cjs");
const { planIntakeMutations } = require("./apply-issue-intake.cjs");
const { callJev } = require("./jev-intake-client.cjs");
const { render, score } = require("./jev-intake-replay-report.cjs");
const {
  buildRequest,
  buildRecheckRequest,
  shortlist,
  mapAnswers,
  AREA_CRITERIA,
  THRESHOLDS,
  DEFAULT_MODEL,
} = require("./jev-issue-intake.cjs");

// The board's duplicate verdicts, 2026-10-17: gh-30 is #6's work (row gh-30,
// done row 005-67); gh-29 is #5's (row gh-29, "no new implementation"); #16
// is #3's (row 004-65, "issue #16 is the same defect").
const DUPLICATES = Object.freeze({ 30: 6, 29: 5, 16: 3 });
const ROUTED = /((?:gh-\d+(?:,\s*|\s+and\s+)?)+)\s+to\s+((\d{3})-\d+)/g;

// Spec number to area, read from the area descriptions so the list has one
// owner (jev-issue-intake.cjs).
function specAreas(criteria = AREA_CRITERIA) {
  const areas = new Map();
  for (const [area, description] of Object.entries(criteria)) {
    for (const [spec] of String(description).matchAll(/\b\d{3}\b/g)) {
      if (areas.has(spec) && areas.get(spec) !== area)
        throw new Error(`spec ${spec} names two areas.`);
      areas.set(spec, area);
    }
  }
  return areas;
}

function addTo(map, key, value) {
  const set = map.get(key) ?? new Set();
  set.add(value);
  map.set(key, set);
}

// Issue number to the areas and to the rows the board routed it to.
function boardTruth(board, specToArea = specAreas()) {
  const areas = new Map();
  const rows = new Map();
  for (const [, issues, row, spec] of board.matchAll(ROUTED)) {
    for (const [, number] of issues.matchAll(/gh-(\d+)/g)) {
      addTo(rows, Number(number), row);
      if (specToArea.has(spec)) addTo(areas, Number(number), specToArea.get(spec));
    }
  }
  return { areas, rows };
}

// A pick of an issue the human merged into the same row without calling it
// a duplicate: neither right nor wrong, a question for the human.
function sameRow(truth, a, b) {
  const rows = truth.rows.get(b);
  return [...(truth.rows.get(a) ?? [])].some((row) => rows?.has(row));
}

// The candidates `target` would have had when it was opened: open issues and
// issues closed in the 30 days before, as creation and close times tell.
// Titles and bodies are today's, the closest record there is.
function candidatesAt(corpus, target) {
  const at = target.created_at;
  const earlier = corpus.issues.filter((issue) => issue.created_at < at);
  return buildCandidates({
    issue: target,
    openIssues: earlier.filter((issue) => issue.closed_at === null || issue.closed_at > at),
    closedIssues: earlier.filter((issue) => issue.closed_at !== null && issue.closed_at <= at),
    repo: corpus.repo,
    now: at,
  });
}

// What the applicator would do with Jev's answer, with closing turned on.
function outcomeOf(intake, target, candidates) {
  const candidateOpen = new Map(candidates.map((c) => [c.number, c.open]));
  const mutations = planIntakeMutations({
    intake,
    issueNumber: target.number,
    knownLabels: new Set(["duplicate"]),
    candidateOpen,
    closeDuplicates: true,
  });
  if (mutations.some((args) => args[1] === "close")) return `close #${intake.duplicate_of}`;
  if (mutations.some((args) => args[1] === "comment")) return `comment #${intake.duplicate_of}`;
  return "none";
}

// What the applicator should do by the board's verdict.
function expectedOutcome(target, candidates) {
  const original = DUPLICATES[target.number];
  if (!original) return "none";
  const candidate = candidates.find((c) => c.number === original);
  if (!candidate) return "none";
  return candidate.open ? `close #${original}` : `comment #${original}`;
}

function evaluate({ corpus, answers, truth, thresholds = THRESHOLDS }) {
  const rows = [];
  for (const target of corpus.issues) {
    const cached = answers[target.number];
    if (!cached) continue;
    const candidates = candidatesAt(corpus, target);
    const request = buildRequest({ issue: target, candidates, model: cached.model });
    const shortlisted = cached.recheck && shortlist({ response: cached, thresholds }).length > 0;
    const recheck = shortlisted
      ? {
          request: buildRecheckRequest({
            issue: target,
            candidates,
            numbers: cached.recheck.numbers,
            model: cached.model,
          }),
          response: cached.recheck,
        }
      : null;
    const intake = mapAnswers({ request, response: cached, recheck, thresholds });
    const outcome = outcomeOf(intake, target, candidates);
    const expected = expectedOutcome(target, candidates);
    rows.push({
      number: target.number,
      title: target.title,
      area: intake.labels.find((label) => label.startsWith("area-")) ?? null,
      type: intake.labels.find((label) => !label.startsWith("area-")) ?? null,
      truthAreas: truth.areas.has(target.number) ? [...truth.areas.get(target.number)] : null,
      outcome,
      expected,
      evidence: intake.comment,
      merged:
        outcome !== "none" &&
        outcome !== expected &&
        sameRow(truth, target.number, intake.duplicate_of),
    });
  }
  return rows.sort((a, b) => a.number - b.number);
}

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fetchCorpus({ dir }) {
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const repo = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
  const jq =
    ".[] | select(.pull_request == null) | {number,title,body,labels: [.labels[].name],created_at,closed_at,updated_at,state_reason}";
  const issues = gh([
    "api",
    "--paginate",
    `repos/${repo}/issues?state=all&per_page=100`,
    "--jq",
    jq,
  ])
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((issue) => ({ ...issue, body: issue.body ?? "" }));
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, "corpus.json"), { repo, fetchedAt: new Date().toISOString(), issues });
  console.log(`${issues.length} issues from ${repo}`);
}

// The replay rechecks the top three of every issue, whatever their rank, so
// the report can apply the shortlist threshold without another call.
async function ask({ dir, model = DEFAULT_MODEL }) {
  const corpus = readJson(path.join(dir, "corpus.json"));
  const answersPath = path.join(dir, "answers.json");
  const answers = readJson(answersPath, {});
  const apiKey = process.env.TYPESAFE_API_KEY;
  for (const target of corpus.issues.filter((issue) => !answers[issue.number])) {
    const candidates = candidatesAt(corpus, target);
    const started = Date.now();
    const request = buildRequest({ issue: target, candidates, model });
    const response = await callJev({ request, apiKey });
    const numbers = shortlist({ response, thresholds: { ...THRESHOLDS, shortlist: 0 } });
    let recheck = null;
    if (numbers.length > 0) {
      const second = buildRecheckRequest({ issue: target, candidates, numbers, model });
      const reply = await callJev({ request: second, apiKey });
      recheck = { numbers, usage: reply.usage, answers: reply.answers };
    }
    const ms = Date.now() - started;
    const { usage, answers: recorded } = response;
    answers[target.number] = { model: response.model, ms, usage, answers: recorded, recheck };
    writeJson(answersPath, answers);
    console.log(`#${target.number} ${response.model} ${ms}ms`);
  }
}

const COMMAND = (dir) =>
  [
    `node .github/scripts/jev-intake-replay.cjs fetch --dir ${dir}`,
    `node .github/scripts/jev-intake-replay.cjs ask --dir ${dir}   # needs TYPESAFE_API_KEY`,
    `node .github/scripts/jev-intake-replay.cjs report --dir ${dir} --board docs/board.md --out docs/specifications/010-ci-cost/research/issue-intake-replay.md`,
  ].join("\n");

function report({ dir, board, out }) {
  const corpus = readJson(path.join(dir, "corpus.json"));
  const answers = readJson(path.join(dir, "answers.json"), {});
  const truth = boardTruth(fs.readFileSync(board, "utf8"));
  const rows = evaluate({ corpus, answers, truth });
  const model = [...new Set(Object.values(answers).map((answer) => answer.model))].join(", ");
  fs.writeFileSync(out, render({ corpus, rows, model, command: COMMAND(dir) }));
  console.log(`wrote ${out}: ${JSON.stringify(rows.length ? score(rows) : { pending: true })}`);
}

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < rest.length; i += 2) options[rest[i].replace(/^--/, "")] = rest[i + 1];
  const run = { fetch: fetchCorpus, ask, report }[command];
  if (!run || !options.dir || (command === "report" && (!options.board || !options.out))) {
    console.error(
      "usage: jev-intake-replay.cjs fetch|ask|report --dir <dir> [--board <board.md> --out <report.md>] [--model <id>]",
    );
    process.exit(2);
  }
  Promise.resolve(run(options)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  boardTruth,
  specAreas,
  candidatesAt,
  evaluate,
  COMMAND,
  DUPLICATES,
};
