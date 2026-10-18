import type { CodexTrust, SetupPlan } from "./plan.js";

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
    lines.push(
      `  ${group.dir} (${group.files.length} files): ${group.reasons.join("; ")}`,
      `    ${group.declaredSlow ? "declared slow" : `not declared slow; default ${group.defaultSlow ? "slow" : "not slow"}`}; inputs: ${group.declaredInputs.join(", ") || "none"}`,
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

  lines.push(
    "",
    `Codex trust: ${trustText(plan.codexTrust)}`,
    `Warm-up: runs all ${plan.warmup.testFiles} test files, ${plan.warmup.withoutCurrentResult} without a current result${plan.warmup.source === "store" ? "" : " (estimated: no daemon has listed them)"}`,
    "",
  );
  if (plan.outdated.length === 0) lines.push("Nothing is outdated.");
  else lines.push("Outdated:", ...plan.outdated.map((line) => `  ${line}`));
  return `${lines.join("\n")}\n`;
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
