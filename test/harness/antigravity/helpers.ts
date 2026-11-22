import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../../src/harness/build.js";

const FIXTURES = join(REPO_ROOT, "test/fixtures/antigravity-hooks");

/** The fixtures' main conversation and its subagent's (spec 024 D2). */
export const CONVERSATION = "00000000-0000-4000-8000-000000000001";
export const SUBAGENT_CONVERSATION = "00000000-0000-4000-8000-000000000002";

/** Every fixture by file name without `.json`. */
export function fixtureNames(): string[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}

/** The fixture `name` as an object, `cwd` and `workspacePaths` pointed at `cwd`. */
export function antigravityInput(
  name: string,
  cwd: string,
  overrides: object = {},
): Record<string, unknown> {
  const input = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as object;
  return { ...input, cwd, workspacePaths: [cwd], ...overrides };
}

/** The fixture `name` as stdin text, `cwd` pointed at `cwd`. */
export function antigravityRecorded(name: string, cwd: string, overrides: object = {}): string {
  return JSON.stringify(antigravityInput(name, cwd, overrides));
}

/** The fixture's raw stdin text, as Antigravity wrote it. */
export function rawFixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.json`), "utf8");
}

/** The edit tools of spec 024 D3, each with its fixture. */
export const EDIT_FIXTURES = [
  ["write_file", "pre-tool-use-write-file"],
  ["edit_file", "pre-tool-use-edit-file"],
  ["write_to_file", "pre-tool-use-write-to-file"],
  ["replace_file_content", "pre-tool-use-replace-file-content"],
  ["multi_replace_file_content", "pre-tool-use-multi-replace-file-content"],
] as const;

/** What an Antigravity hook injected as a system message; `""` for no output. */
export function injected(out: string | { readonly stdout: string }): string {
  const stdout = typeof out === "string" ? out : out.stdout;
  if (stdout === "") return "";
  const parsed = JSON.parse(stdout) as {
    injectSteps: { systemMessage: { systemMessage: string } }[];
  };
  const [step, ...more] = parsed.injectSteps;
  if (step === undefined || more.length > 0) throw new Error("not one injected step");
  return step.systemMessage.systemMessage;
}
