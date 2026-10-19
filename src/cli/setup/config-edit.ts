import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { POLICY_FILE } from "../../core/daemon/policy.js";
import { isRecord } from "../../core/fs/index.js";
import type { AbsolutePath } from "../../core/types/index.js";
import type { SetupChoices } from "./apply.js";

/* `squeal init`'s setup choices as `squeal.config.json` edits (spec 005 D3 step 4). */

/**
 * Adds `--slow` globs to `slow.include`, `--input` globs to the `inputs` map
 * and `--exclude` globs to each runner's `exclude`, keeping the rest.
 */
export function editConfig(
  root: AbsolutePath,
  choices: SetupChoices,
  exclude: (config: Record<string, unknown>) => string[],
): string[] {
  const path = join(root, POLICY_FILE);
  const text = readOrEmpty(path);
  const config = readConfig(root) ?? {};
  const lines: string[] = [];
  const slow = isRecord(config.slow) ? { ...config.slow } : {};
  const include = Array.isArray(slow.include) ? [...(slow.include as unknown[])] : [];
  for (const glob of choices.slow) {
    if (include.includes(glob)) continue;
    include.push(glob);
    lines.push(`added ${glob} to slow.include in ${POLICY_FILE}`);
  }
  if (choices.slow.length > 0) config.slow = { ...slow, include };
  const inputs: Record<string, unknown> = isRecord(config.inputs) ? { ...config.inputs } : {};
  for (const { test, input } of choices.inputs) {
    const globs = Array.isArray(inputs[test]) ? [...(inputs[test] as unknown[])] : [];
    if (globs.includes(input)) continue;
    inputs[test] = [...globs, input];
    lines.push(`added ${input} to inputs["${test}"] in ${POLICY_FILE}`);
  }
  if (choices.inputs.length > 0) config.inputs = inputs;
  lines.push(...exclude(config));
  if (lines.length > 0) {
    const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? 2;
    writeFileSync(path, `${JSON.stringify(config, null, indent)}\n`);
  }
  return lines;
}

export function readConfig(root: AbsolutePath): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(join(root, POLICY_FILE), "utf8"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
