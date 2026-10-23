import { posix } from "node:path";
import { plural, shellWord } from "../text.js";
import type { NextStep, Step } from "./next-step.js";

/*
 * Row 011-27: a group's next step in words, with its paths in the command
 * (`nextStep`'s `Step`), as the class lines, the verdict line and each
 * `--json` entry give it.
 */

/** How many paths a group's command names before it names `<test file>...` (design Q5). */
export const PATHS_IN_COMMAND = 3;

/**
 * The group's step in words, its paths in the command: `` `squeal retry
 * a.test.ts` runs it once ``. Above `PATHS_IN_COMMAND` files a retry names
 * `<test file>...` and the full-suite run. Empty when nothing is needed.
 */
export function stepText(step: Step, paths: readonly string[], command: string): string {
  const n = paths.length;
  const it = n === 1 ? "it" : "them";
  const cmd = stepCommand(step, paths, command);
  switch (step.kind) {
    case "retry": {
      if (step.again === true) {
        const one = n === 1 ? "this one file" : "each of them";
        return `after an environment failure, \`${cmd}\` runs ${one} again`;
      }
      const runs = n === 1 ? "runs it once" : "runs each once";
      const every =
        step.all === undefined ? "every test file" : `all ${plural(step.all, "test file")}`;
      const all =
        n > PATHS_IN_COMMAND
          ? `, \`${command} run --all --wait\` runs ${every} not current here`
          : "";
      return `\`${cmd}\` ${runs}${all}${(step.note ?? "").replaceAll("{it}", it)}`;
    }
    case "command":
    case "shell":
      return step.kind === "command" && step.said === true ? "" : fill(step.text, cmd, command, it);
    case "none":
      return fill(step.text, null, command, it);
  }
}

/** A group's reason in words: `{command}` is its step's, in backticks. */
export function reasonWords(next: NextStep, paths: readonly string[], command: string): string {
  return fill(
    next.reason,
    stepCommand(next.step, paths, command),
    command,
    paths.length === 1 ? "it" : "them",
  );
}

/**
 * `path`, relative to the worktree root, as a command run from `base` names
 * it: `base` is the directory the selection's paths were resolved against,
 * relative to the root (`""` the root itself). An absolute `base`, outside the
 * root, keeps the root's reading. `squeal retry` resolves its arguments
 * against the cwd, so a printed command must too (review of cand/0.1.231, B1).
 */
export function fromBase(base: string | undefined, path: string): string {
  if (base === undefined || base === "" || posix.isAbsolute(base)) return path;
  return posix.relative(base, path);
}

/**
 * The group's command with its paths, for the verdict line and `--json`;
 * `null` for none. Each path is one shell word (row 011-130).
 */
export function stepCommand(step: Step, paths: readonly string[], command: string): string | null {
  switch (step.kind) {
    case "retry": {
      const files =
        paths.length > PATHS_IN_COMMAND ? "<test file>..." : paths.map(shellWord).join(" ");
      return `${command} retry ${files}${step.again === true ? " --reason environment" : ""}`;
    }
    case "command":
      return `${command} ${step.args}`;
    case "shell":
      return step.command;
    case "none":
      return null;
  }
}

/** `text` with `{command}` in backticks, `{squeal}` the CLI's name, `{it}` as given and `{its}` to match. */
export function fill(text: string, cmd: string | null, command: string, it: string): string {
  return text
    .replaceAll("{command}", cmd === null ? "" : `\`${cmd}\``)
    .replaceAll("{squeal}", command)
    .replaceAll("{its}", it === "it" ? "its" : "their")
    .replaceAll("{it}", it);
}
