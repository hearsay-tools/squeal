import type {
  CheckError,
  CheckId,
  RelativePath,
  SourceLocation,
  TestFileFrame,
} from "../types/index.js";

/*
 * 011 C5 as amended 2026-10-21 (gh-67, row 011-64 R2): a failure whose
 * location is not in its check's own test file also names the first frame in
 * that file, `at <location>, called from <path>:<line>[:<column>]`. The frame
 * is read, when shown, from the first error's stored stack, the source-mapped
 * text the runner reported. It is never stored and never guessed.
 */

/** A V8 frame: `at <function> (<position>)` or `at <position>`. */
const V8_FRAME = /^\s*at (.+?)\s*$/;

/** A V8 position, `<path>:<line>:<column>`; the path may hold parentheses, as a route group's. */
const V8_POSITION = /^(.+):(\d+):(\d+)$/;

/** pytest's long and short tracebacks begin an entry `<path>:<line>: `, the path from pytest's cwd. */
const PYTEST_ENTRY = /^([^\s:]+):(\d+):(?: |$)/;

/** pytest's native traceback: `File "<path>", line <n>`, absolute, so root-relative once stored. */
const NATIVE_ENTRY = /^\s*File "(.+)", line (\d+)/;

interface Position {
  readonly path: string;
  readonly line: number;
  readonly column?: number;
}

/** The position a V8 frame names: inside the parentheses after the first ` (`, else the rest. */
function v8Position(frame: string): Position | null {
  const open = frame.indexOf(" (");
  const where = open !== -1 && frame.endsWith(")") ? frame.slice(open + 2, -1) : frame;
  const match = V8_POSITION.exec(where);
  if (match === null) return null;
  return { path: match[1] as string, line: Number(match[2]), column: Number(match[3]) };
}

function positions(stack: string): Position[] {
  return stack.split("\n").flatMap((text): Position[] => {
    const v8 = V8_FRAME.exec(text);
    const position = v8 === null ? null : v8Position(v8[1] as string);
    if (position !== null) return [position];
    const entry = PYTEST_ENTRY.exec(text) ?? NATIVE_ENTRY.exec(text);
    return entry === null ? [] : [{ path: entry[1] as string, line: Number(entry[2]) }];
  });
}

/**
 * What the stack's paths lack before a root-relative path: `""`, or the cwd
 * of a pytest project below the root, whose long and short reports name
 * paths from it. Read from the position that names `location`; `null` when
 * none does, so the stack is not known to be the location's.
 */
function prefixOf(found: readonly Position[], location: SourceLocation): string | null {
  const named = found.find(
    (p) =>
      p.line === location.line &&
      (p.column === undefined || p.column === location.column) &&
      (p.path === location.path || location.path.endsWith(`/${p.path}`)),
  );
  return named === undefined ? null : location.path.slice(0, -named.path.length);
}

/**
 * The first frame of `errors[0]`'s stack in `check`'s own test file; `null`
 * when the check has no test file of its own (a setup check), when the error
 * has no location or stack, when the location is in the test file, or when
 * the stack does not name the location or holds no frame in the test file.
 */
export function testFileFrame(check: CheckId, errors: readonly CheckError[]): TestFileFrame | null {
  const first = errors[0];
  const location = first?.location ?? null;
  const stack = first?.stack ?? null;
  if (check.kind === "setup" || check.testPath === "" || location === null || stack === null) {
    return null;
  }
  if (location.path === check.testPath) return null;
  const found = positions(stack);
  const prefix = prefixOf(found, location);
  if (prefix === null) return null;
  const frame = found.find((p) => `${prefix}${p.path}` === check.testPath);
  if (frame === undefined) return null;
  return {
    path: check.testPath as RelativePath,
    line: frame.line,
    ...(frame.column === undefined ? {} : { column: frame.column }),
  };
}

/** `<path>:<line>[:<column>]`. */
function positionText({ path, line, column }: TestFileFrame): string {
  return column === undefined ? `${path}:${line}` : `${path}:${line}:${column}`;
}

/** `<location>`, then `, called from <frame>` when the failure has one. */
export function locationText(location: SourceLocation, frame: TestFileFrame | undefined): string {
  const at = positionText(location);
  return frame === undefined ? at : `${at}, called from ${positionText(frame)}`;
}

/** `at <location>[, called from <frame>]`, as a failure prints it. */
export function atText(location: SourceLocation, frame: TestFileFrame | undefined): string {
  return `at ${locationText(location, frame)}`;
}
