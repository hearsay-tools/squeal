import { plural, testFileText } from "../text.js";
import type { CommitLine, NotDeterminedTestFile } from "../types/index.js";

/**
 * Spec 019 D5 step 3 (row 019-16): the newest commit report's line. With
 * `--full` (row 019-37, lessons P11), a line under it per test file not
 * determined for the commit, with the paths that make it so, and how many
 * more the report did not keep.
 */
export function commitLines(line: CommitLine | undefined, full: boolean): string[] {
  if (line === undefined) return [];
  const { notDetermined } = line;
  if (!full || notDetermined === undefined) return [line.text];
  const more = notDetermined.count - notDetermined.files.length;
  return [
    line.text,
    ...notDetermined.files.map((file) => `  ${notDeterminedText(file)}`),
    ...(more > 0 ? [`  ${plural(more, "more test file")} not determined`] : []),
  ];
}

/** The part `--full` adds for the commit line, for the `More:` line; none without it. */
export function commitHiddenParts(line: CommitLine | undefined): string[] {
  const count = line?.notDetermined?.count ?? 0;
  return count === 0 ? [] : [`the commit's ${plural(count, "test file")} not determined`];
}

/**
 * `test/a.test.ts is not determined: src/a.ts and src/b.ts differ from the
 * commit`, or the working tree deleted it.
 */
function notDeterminedText(file: NotDeterminedTestFile): string {
  const name = `${testFileText(file)} is not determined`;
  if (file.deleted === true || file.through.length === 0) {
    return `${name}: the working tree deleted it`;
  }
  const more = file.more ?? 0;
  const paths = [...file.through, ...(more > 0 ? [plural(more, "more path")] : [])];
  const verb = paths.length === 1 ? "differs" : "differ";
  return `${name}: ${andText(paths)} ${verb} from the commit`;
}

/** `a`, `a and b`, `a, b and c`. */
function andText(words: readonly string[]): string {
  return words.length < 2
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
