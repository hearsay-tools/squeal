import { vitestBelowRootNote } from "../../core/daemon/runner.js";
import { excludeKeys } from "./exclude.js";
import type { CodexTrust, Runners, SetupPlan, Warmup } from "./plan.js";

/** The plan for a human: one section per D3 step 2 fact, then what is outdated. */
export function formatPlan(plan: SetupPlan): string {
  const lines = [`Squeal setup plan for ${plan.root}`, "", "Harnesses:"];
  for (const h of plan.harnesses) {
    const plugin =
      h.plugin === null ? "plugin not installed" : `plugin ${h.plugin.version} (${h.plugin.scope})`;
    lines.push(`  ${h.id}: ${h.onPath ? "on the PATH" : "not on the PATH"}, ${plugin}`);
    if (h.onPath && h.plugin === null) {
      lines.push(...h.installCommands.map((c) => `    install: ${c}`));
    }
  }
  const nodeTest = plan.runners.nodeTest.map(
    (p) => `${p.name}${p.source === "seed" ? " (squeal init would seed it)" : ""}`,
  );
  const pytest = (plan.runners.pytest ?? []).map(
    (p) => `pytest ${p.name}${p.source === "seed" ? " (squeal setup would seed it)" : ""}`,
  );
  lines.push(
    "",
    `Runners: ${[plan.runners.vitest ? "Vitest" : null, ...nodeTest.map((n) => `node:test ${n}`), ...pytest].filter((r) => r !== null).join(", ") || "none found"}`,
    ...(plan.runners.pytest ?? []).flatMap((p) => p.notes.map((n) => `  note: ${n}`)),
    ...gapLines(plan.runners),
  );
  const config = plan.config;
  lines.push(
    `Config: ${config.path} ${
      config.exists
        ? config.tracked
          ? "exists, tracked by git"
          : "exists, not tracked by git: commit it"
        : config.elsewhere === null
          ? "is missing"
          : `is missing here; one is in ${config.elsewhere}`
    }`,
    ...config.problems.map((p) => `  problem: ${p}`),
  );

  lines.push("", "Instruction files:");
  if (plan.instructions.length === 0) lines.push("  none");
  for (const file of plan.instructions) {
    const aliases = file.aliases.length === 0 ? "" : ` (also ${file.aliases.join(", ")})`;
    const block =
      file.block.state === "absent"
        ? "no Squeal block"
        : file.block.state === "unterminated"
          ? `a Squeal block begins at line ${file.block.line} with no end: fix it by hand`
          : `Squeal block v${file.block.version} at line ${file.block.line}, ${file.block.state}`;
    lines.push(
      `  ${file.path}${aliases}: read by ${file.harnesses.join(" and ")}; ${file.exists ? block : "does not exist"}`,
    );
    const squeal = plan.squealMentions.find((m) => m.file === file.path);
    if (squeal !== undefined) {
      lines.push(
        `    Squeal already named outside the block, line ${squeal.line}: ${squeal.text.trim()}`,
      );
    }
  }

  lines.push("", "Gate lines:");
  if (plan.gates.length === 0) lines.push("  none");
  for (const gate of plan.gates) {
    lines.push(`  ${gate.id}: ${gate.text.trim()}`);
    lines.push(
      gate.proposed === null
        ? `    ${gate.reason}: reword it by hand`
        : `    reworded: ${gate.proposed.trim()}`,
    );
  }
  if (plan.mentions.length > 0) {
    lines.push("  The test command where it is no gate (not offered as edits):");
    for (const m of plan.mentions) lines.push(`    ${m.file}:${m.line}: ${m.text.trim()}`);
  }

  lines.push("", "Slow groups:");
  if (plan.slow.groups.length === 0) lines.push("  none found");
  for (const group of plan.slow.groups) {
    // Row 005-70: an exclude candidate's default is its runners' `exclude`, never slow.
    const exclude = group.declaredSlow ? null : (group.exclude ?? null);
    const slow = `default ${group.defaultSlow ? "slow" : "not slow"}`;
    // B1: a partial exclude names its files; the rest keep the slow default.
    const byDefault =
      exclude === null
        ? slow
        : exclude.kept.length === 0
          ? `default excluded (${excludeKeys(exclude)})`
          : `default excluded: ${exclude.globs.join(", ")} (${excludeKeys(exclude)}); the ${exclude.kept.length} other${exclude.kept.length === 1 ? "" : "s"} ${slow}`;
    lines.push(
      `  ${group.dir} (${group.files.length} files): ${group.reasons.join("; ")}`,
      ...(group.buildOutputs ?? []).map(
        (o) =>
          `    tests build output ${o.path}${o.exists ? "" : " (not built here)"}: ${o.evidence.map((e) => e.detail).join("; ")}`,
      ),
      `    ${group.declaredSlow ? "declared slow" : `not declared slow; ${byDefault}`}; inputs: ${group.declaredInputs.join(", ") || "none"}`,
    );
  }
  for (const script of plan.slow.unresolvedScripts) {
    lines.push(`  not resolved statically: ${script}`);
  }
  // 004 D7 (task 004-81): suites Squeal does not cover; none excluded, no section.
  const excluded = plan.excluded?.vitest ?? [];
  if (excluded.length > 0) {
    lines.push("", "Not covered, excluded by squeal.config.json:");
    for (const glob of excluded) lines.push(`  Vitest test files matching ${JSON.stringify(glob)}`);
  }

  lines.push("", `Codex trust: ${trustText(plan.codexTrust)}`, warmupLine(plan.warmup), "");
  if (plan.outdated.length === 0) lines.push("Nothing is outdated.");
  else lines.push("Outdated:", ...plan.outdated.map((line) => `  ${line}`));
  return `${lines.join("\n")}\n`;
}

/**
 * Rows 005-79 and 005-80 (D3 step 2 as amended 2026-10-22): what the config
 * leaves out or runs twice, each with its fix. None makes `--check` exit 1.
 */
function gapLines(runners: Runners): string[] {
  const below = runners.vitestBelowRoot ?? [];
  const leftOut = runners.nodeTestLeftOut ?? { notes: [], templates: [] };
  return [
    ...(below.length === 0 ? [] : [`  not run: ${vitestBelowRootNote(below)}`]),
    ...leftOut.notes.map((note) => `  not run: ${note}`),
    ...(leftOut.templates.length === 0
      ? []
      : [
          "    nodeTest entries to complete by hand:",
          ...JSON.stringify(leftOut.templates, null, 2)
            .split("\n")
            .map((line) => `    ${line}`),
        ]),
    ...(runners.pytestOverlaps ?? []).map(
      ({ projects: [a, b], testFiles, fix }) =>
        `  run twice: ${testFiles} test file${testFiles === 1 ? "" : "s"} that pytest projects "${a}" and "${b}" both select; to run each once, ${fix}`,
    ),
  ];
}

/** Row 005-80: the runs a warm-up makes, one per project and file, and the paths when fewer. */
function warmupLine(warmup: Warmup): string {
  const paths =
    warmup.paths === undefined || warmup.paths === warmup.testFiles
      ? ""
      : `, one run per project and file (${warmup.paths} paths)`;
  const estimated = warmup.source === "store" ? "" : " (estimated: no daemon has listed them)";
  return `Warm-up: runs all ${warmup.testFiles} test files${paths}, ${warmup.withoutCurrentResult} without a current result${estimated}`;
}

function trustText(trust: CodexTrust): string {
  switch (trust.state) {
    case "not-checked":
      return `not checked; ${trust.command} checks it`;
    case "trusted":
      return `all ${trust.hooks} hooks of the plugin trusted`;
    case "untrusted":
      return `${trust.untrusted} of ${trust.hooks} hooks of the plugin not trusted; ${trust.command} has Codex trust them`;
    case "unavailable":
      return `not read (${trust.reason}); ${trust.command} checks it`;
  }
}
