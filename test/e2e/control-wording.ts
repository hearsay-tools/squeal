import { primer } from "../../src/harness/shared/primer.js";

/*
 * Row 005-94 (the human, 2026-11-17, `tasks/005-94/texts.md` "Decided"): what the 0.1.393
 * control's hook texts read as after the wording pass. `squeal status` keeps its counts, its
 * checkpoint and its commit, so a status text (`Revision: …`) is left as printed.
 */

/** A start message: the text's last paragraph, or the whole text after `compact`. */
const START_MESSAGE = /(^|\n\n)Squeal runs this repository's [^\n]*$/;

/**
 * Row 005-128 (spec 005 D6 as amended 2026-11-19): the long start message is the short one,
 * naming the same CLI.
 */
function startMessage(text: string, command: string): string {
  return text.replace(START_MESSAGE, (_, before: string) => `${before}${primer(command)}`);
}

/** The meaning of "current" the hooks say in place (R1). */
const DEFINED = "(run on the files as they are now)";

/**
 * The CLI a hook text names: its `Full output:` line's, else its first command, else `squeal`.
 * A command is read from one line, so a capture cannot start at a closing backtick and run on
 * into the next paragraph (row 025-32, review 0.1.657-r2).
 */
function commandOf(text: string): string {
  return (
    /^Full output: (.+?) why /m.exec(text)?.[1] ??
    /`([^`\n]+?) (?:status|run|retry|code|lint)\b/.exec(text)?.[1] ??
    "squeal"
  );
}

const verb = (...counts: number[]) => (counts.includes(1) ? "is" : "are");
const files = (n: number) => `${n} test file${n === 1 ? "" : "s"}`;

/** R1: the `Known failures` line's tail, how many test files are current. */
function knownFailuresTail(line: string, command: string): string {
  const all = /; (all )?(\d+) test files? current$/.exec(line);
  if (all !== null) {
    const total = Number(all[2]);
    const head = line.slice(0, all.index);
    return `${head}; ${all[1] ?? ""}${files(total)} ${verb(total)} current ${DEFINED}.`;
  }
  const not =
    /; not current: (\d+) of (\d+) test files? \([^)]*\)(?:, \d+ tests? \([^)]*\))?(?:; revision \d+ is not listed yet, so test files it adds are not counted)?$/.exec(
      line,
    );
  if (not === null) return line;
  const total = Number(not[2]);
  const current = total - Number(not[1]);
  return (
    `${line.slice(0, not.index)}; ${current} of ${files(total)} ${verb(current, total)} current ` +
    `${DEFINED}, and \`${command} status\` counts the rest.`
  );
}

/** The changed paths after a revision; a path's own `)` does not end them (review 0.1.379 S2). */
const REVISION = String.raw`Revision \d+(?: \(changed (?:[^)\n]|\)(?!: ))*\))?`;
/** A line the wording pass leaves out. */
const GONE = "<gone in 005-94>";
/** 0.1.393's full header line: its counts, then the checkpoint, then the daemon's sentences. */
const FULL = new RegExp(
  `^(${REVISION}): \\d+ current\\b[^\\n]*? Full-suite checkpoint: (?:completed at revision \\d+|none completed [^\\n]*?requests one\\))\\.([^\\n]*)$`,
  "m",
);
/** 0.1.393's owed counts (011-205): the full counts with no checkpoint, once after the listing. */
const OWED = new RegExp(
  `^(${REVISION}): \\d+ current\\b[^\\n]*?, 0 pending\\b[^\\n]*?, 0 stale\\b[^\\n]*?, 0 unknown\\b[^\\n]*$`,
  "m",
);

/**
 * R1 and C2: the registration's and Stop's line after the title keeps only what it has to say,
 * the changed paths and the daemon's sentences, or goes; the owed counts say how far the first
 * results reach, here every test file, as at the fixture's quiet points.
 */
function revisionLines(text: string, total: number): string {
  return text
    .replace(FULL, (_, revision: string, rest: string) => {
      if (rest !== "") return `${revision}:${rest}`;
      return revision.includes("(changed ") ? `${revision}.` : GONE;
    })
    .replace(OWED, (line: string, revision: string) =>
      /Test files without checks: [^.]*[1-9]\d* pending/.test(line)
        ? line
        : `${revision}: all ${files(total)} ${verb(total)} current ${DEFINED}.`,
    )
    .split("\n")
    .filter((line) => line !== GONE)
    .join("\n");
}

/** Texts.md 3: no results revision while unlisted; with no daemon, one sentence. */
function unlisted(text: string, command: string): string {
  return text
    .replace(
      /Squeal is still starting in this worktree and has no results yet\. `[^`]*status --wait 60000 <path>\.\.\.` waits for the files you change\. No daemon is running; results are as of revision \d+\./,
      `Squeal has no results in this worktree yet, and no daemon is running; \`${command} start\` starts one.`,
    )
    .replace(
      /( waits for the files you change\.) A daemon is starting; results are as of revision \d+\./,
      "$1",
    );
}

/** Texts.md 2 and 5: the primer's clauses and the first-edit line. */
function sentences(text: string): string {
  return text
    .replace(
      ", and passing results stay silent, so keep working;",
      "; passes stay silent unless they follow a failure, so keep working;",
    )
    .replace(
      /; before you finish, ((?:the CLI's )?`[^`]*status --wait 60000`) or a checkpoint, (?:the CLI's )?`[^`]*run --all --wait`\./,
      ", and $1 before you finish.",
    )
    .replace(
      "when no daemon is validating, when results are unknown,",
      "when no daemon is validating, when Squeal's run left a result unknown,",
    )
    .replace(
      "results arrive with later tool calls, and passing ones stay silent.",
      "results arrive with later tool calls, and passes stay silent unless they follow a failure.",
    );
}

/**
 * A 0.1.393 hook text as row 005-94 words it: no commit after a revision, the short form of the
 * registration and Stop with the `Known failures` line counting current test files (of `total`),
 * no count in progress at registration, the unlisted sentences, and the primer's and first-edit
 * line's clauses. A status text is returned as printed.
 */
export function wordingPass(text: string, total: number): string {
  if (text.startsWith("Revision: ")) return text;
  const command = commandOf(text);
  const lines = revisionLines(
    unlisted(sentences(startMessage(text, command)), command).replace(
      /^(Revision \d+) · \S+ \+ \d+(?:, dirty)?(?= \(changed |[:.])/gm,
      "$1",
    ),
    total,
  )
    .split("\n")
    .map((line) => (line.startsWith("Known failures: ") ? knownFailuresTail(line, command) : line));
  const registration = text.startsWith("SQUEAL · registered");
  return lines
    .filter((line) => !registration || !/^(?:Complexity: counting|Lint: linting)/.test(line))
    .join("\n");
}
