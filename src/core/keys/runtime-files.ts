import { statSync } from "node:fs";
import { join } from "node:path";
import type { TestFileRef } from "../types/keys.js";
import type { PolicyInputs, RuntimeFileApplication, RuntimeFileRule } from "../types/policy.js";
import { isInputList } from "./closure.js";
import { createInputMatcher } from "./glob.js";

/** Lexical exact files only. This deliberately does not expand symlinks. */
export function normalizeRuntimePath(given: string): string {
  const path = given.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  const parts = path.split("/");
  if (
    !path ||
    path === "." ||
    path.startsWith("/") ||
    /^[a-z]:/i.test(path) ||
    path.includes("\0") ||
    /[*?{}[\]!]/.test(path) ||
    parts.some((part) => ["..", ".git", "node_modules"].includes(part)) ||
    path.endsWith("/")
  )
    throw new Error(`invalid exact runtime file: ${given}`);
  return parts.filter((part) => part !== "" && part !== ".").join("/");
}

/** One owner of runtime scope, protection and effective observations. */
export class RuntimeFiles {
  readonly #rules;
  readonly #declared;
  constructor(
    rules: readonly RuntimeFileRule[],
    inputs: PolicyInputs,
    private readonly root: string,
  ) {
    this.#rules = rules.map((rule) => ({ ...rule, matches: createInputMatcher(rule.tests) }));
    this.#declared = isInputList(inputs)
      ? [{ applies: () => true, matches: createInputMatcher(inputs) }]
      : Object.entries(inputs).map(([test, globs]) => ({
          applies: createInputMatcher([test]),
          matches: createInputMatcher(globs),
        }));
  }

  candidates(): string[] {
    return [...new Set(this.#rules.flatMap((rule) => rule.paths))].sort();
  }

  unmatched(refs: readonly TestFileRef[]): string[] {
    return this.#rules
      .filter((rule) => !refs.some((ref) => ref.project === rule.project && rule.matches(ref.path)))
      .map(
        (rule) =>
          `runtimeFiles: project ${JSON.stringify(rule.project)}, tests ${rule.tests.join(", ")}: no current reader`,
      );
  }

  selected(ref: TestFileRef): string[] {
    return [
      ...new Set(
        this.#rules
          .filter((rule) => rule.project === ref.project && rule.matches(ref.path))
          .flatMap((rule) => rule.paths),
      ),
    ].sort();
  }

  classify(
    ref: TestFileRef,
    protectedReason: (path: string) => string | undefined,
    verified = true,
  ): RuntimeFileApplication {
    const paths: string[] = [];
    const conflicts: { path: string; reason: string }[] = [];
    for (const path of this.selected(ref)) {
      let reason = protectedReason(path);
      if (path === ref.path) reason = "test file";
      else if (path === "squeal.config.json") reason = "policy file";
      else if (path.split("/").at(-1) === "package.json") reason = "package manifest";
      else if (this.#declared.some((rule) => rule.applies(ref.path) && rule.matches(path)))
        reason = "declared input";
      else {
        try {
          if (statSync(join(this.root, path), { throwIfNoEntry: false })?.isDirectory())
            reason = "directory";
        } catch {
          reason = "path cannot be inspected";
        }
      }
      if (!verified) reason ??= "runner closure is unverified";
      if (reason) conflicts.push({ path, reason });
      else paths.push(path);
    }
    return { paths, conflicts, verified };
  }

  effective(raw: readonly string[], applied: RuntimeFileApplication): string[] {
    const excluded = new Set(applied.paths);
    return raw.filter((path) => !excluded.has(path));
  }
}

export function runtimeIdentity(paths: readonly string[]): string {
  return paths.length === 0 ? "" : JSON.stringify(["squeal-runtime-files/1", paths]);
}
