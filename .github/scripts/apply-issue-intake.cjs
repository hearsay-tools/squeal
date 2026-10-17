"use strict";

// The only code that mutates an issue during intake (spec 010 D12), ported
// from hearsay-tools/cezarion at 10cec2e9. It reads the intake.json the Jev
// job wrote, checks every label against the repository's labels and every
// duplicate pick against the rebuilt candidate set, and returns `gh` argument
// lists. `needs-triage` is not its job: the workflow's last step adds it to
// any issue still open.

const ACTIONS = new Set(["duplicate", "label", "skip"]);
const CLOSE_VARIABLE = "ISSUE_INTAKE_CLOSE_DUPLICATES";

function assertKeys(value, allowed, label) {
  for (const key of Object.keys(value))
    if (!allowed.has(key)) throw new Error(`${label} has unknown key "${key}".`);
}
function assertRequired(value, required, label) {
  for (const key of required)
    if (!Object.hasOwn(value, key)) throw new Error(`${label} ${key} is required.`);
}

function validateIntake(intake) {
  if (!intake || typeof intake !== "object" || Array.isArray(intake))
    throw new Error("Intake must be an object.");
  assertKeys(intake, new Set(["action", "duplicate_of", "comment", "labels"]), "Intake");
  assertRequired(intake, ["action", "duplicate_of", "comment", "labels"], "Intake");
  if (!ACTIONS.has(intake.action)) throw new Error("action is invalid.");
  if (
    intake.duplicate_of !== null &&
    (!Number.isInteger(intake.duplicate_of) || intake.duplicate_of <= 0)
  ) {
    throw new Error("duplicate_of must be a positive integer or null.");
  }
  if (
    intake.comment !== null &&
    (typeof intake.comment !== "string" || intake.comment.trim().length === 0)
  ) {
    throw new Error("comment must be a non-empty string or null.");
  }
  if (
    !Array.isArray(intake.labels) ||
    intake.labels.some((label) => typeof label !== "string" || label.length === 0)
  ) {
    throw new Error("labels must be an array of non-empty strings.");
  }
}

function loadIntake(input) {
  let intake;
  try {
    intake = typeof input === "string" ? JSON.parse(input) : input;
  } catch (error) {
    throw new Error(`Invalid intake JSON: ${error.message}`);
  }
  validateIntake(intake);
  return intake;
}

function labelMutations(intake, issueNumber, knownLabels) {
  const labels = intake.labels.filter((label) => knownLabels.has(label));
  if (labels.length === 0) return [];
  return [["issue", "edit", String(issueNumber), "--add-label", labels.join(",")]];
}

function commentMutation(issueNumber, body) {
  return ["issue", "comment", String(issueNumber), "--body", body];
}

// candidateOpen maps each duplicate candidate rebuilt by
// issue-intake-candidates.cjs to whether it is open. A pick of an open
// candidate closes the issue when closeDuplicates is on; a pick of a closed
// one, or any pick while closing is off, comments and labels. A pick outside
// the set (the issue itself, a split-out parent, an old issue) only labels.
function planIntakeMutations({
  intake,
  issueNumber,
  knownLabels,
  candidateOpen,
  closeDuplicates,
  warn = () => {},
}) {
  validateIntake(intake);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0)
    throw new Error("issueNumber must be a positive integer.");
  if (!(knownLabels instanceof Set)) throw new Error("knownLabels must be a Set.");
  if (!(candidateOpen instanceof Map)) throw new Error("candidateOpen must be a Map.");
  if (typeof closeDuplicates !== "boolean") throw new Error("closeDuplicates must be a boolean.");

  if (intake.action === "skip") return [];
  if (intake.action === "label") return labelMutations(intake, issueNumber, knownLabels);

  const original = intake.duplicate_of;
  if (original === null) throw new Error("duplicate_of is required for a duplicate action.");
  if (!candidateOpen.has(original)) {
    warn(`#${original} is not a duplicate candidate for #${issueNumber}; labeling instead.`);
    return labelMutations(intake, issueNumber, knownLabels);
  }
  if (original === issueNumber) throw new Error("An issue cannot be a duplicate of itself.");
  if (typeof intake.comment !== "string") throw new Error("A duplicate pick requires a comment.");
  if (!candidateOpen.get(original)) {
    return [
      commentMutation(
        issueNumber,
        `Possibly the same as #${original}, closed (${intake.comment}).`,
      ),
      ...labelMutations(intake, issueNumber, knownLabels),
    ];
  }
  if (!closeDuplicates) {
    return [
      commentMutation(
        issueNumber,
        `Possibly the same as #${original} (${intake.comment}). Not closed: ${CLOSE_VARIABLE} is off.`,
      ),
      ...labelMutations(intake, issueNumber, knownLabels),
    ];
  }
  // The label goes first: if the close then fails, the issue stays open and
  // the workflow's last step still marks it for triage.
  return [
    ...(knownLabels.has("duplicate")
      ? [["issue", "edit", String(issueNumber), "--add-label", "duplicate"]]
      : []),
    [
      "issue",
      "close",
      String(issueNumber),
      "--reason",
      "duplicate",
      "--duplicate-of",
      String(original),
      "--comment",
      `Duplicate of #${original} (${intake.comment}).`,
    ],
  ];
}

module.exports = { loadIntake, planIntakeMutations, validateIntake, CLOSE_VARIABLE };
