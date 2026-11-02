// Throwaway probe for 019 commit-checkpoint (see README.md). Counts, over the
// host's Claude Code transcripts of the squeal project and its worktrees,
// the Bash calls that run `git commit`: their shell forms, and for
// `--no-verify` whether the session's commit just before it failed with a
// hook's refusal. Prints counts only, never command text.
// Usage: node transcripts.mjs [projects dir, default ~/.claude/projects] [project-name substring, default squeal]
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] || join(homedir(), ".claude", "projects");
const project = process.argv[3] ?? "squeal";
const COMMIT = /\bgit\b[^\n|;&]*\bcommit\b/;
// The characters `shellWords` (src/harness/shared/test-command.ts) refuses.
const SPECIAL = /[|&;()<>$`\\#*?[\]{}~!\n\r]/;
const HOOK_REFUSAL = /pre-commit|hook|husky|lefthook|lint-staged/i;
const n = {
  sessions: 0,
  commitCalls: 0,
  shellWordsAccepts: 0,
  chainedWithAnd: 0,
  heredocMessage: 0,
  gitDashC: 0,
  amend: 0,
  noVerify: 0,
  commitFailed: 0,
  commitFailedWithHookText: 0,
  noVerifyAfterHookFailure: 0,
};
for (const d of readdirSync(base).filter((d) => d.includes(project))) {
  const dir = join(base, d);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    n.sessions++;
    const calls = new Map();
    let lastCommitHookFailed = false;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.includes("commit") && !line.includes("tool_result")) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const content = o?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c.type === "tool_use" && c.name === "Bash") {
          const cmd = String(c.input?.command ?? "");
          if (!COMMIT.test(cmd)) continue;
          n.commitCalls++;
          if (!SPECIAL.test(cmd)) n.shellWordsAccepts++;
          if (cmd.includes("&&")) n.chainedWithAnd++;
          if (cmd.includes("<<")) n.heredocMessage++;
          if (/\bgit\s+-C\s/.test(cmd)) n.gitDashC++;
          if (cmd.includes("--amend")) n.amend++;
          if (cmd.includes("--no-verify")) {
            n.noVerify++;
            if (lastCommitHookFailed) n.noVerifyAfterHookFailure++;
          }
          calls.set(c.id, true);
        } else if (c.type === "tool_result" && calls.has(c.tool_use_id)) {
          const text = JSON.stringify(c.content ?? "");
          lastCommitHookFailed = false;
          if (c.is_error === true) {
            n.commitFailed++;
            if (HOOK_REFUSAL.test(text)) {
              n.commitFailedWithHookText++;
              lastCommitHookFailed = true;
            }
          }
        }
      }
    }
  }
}
console.log(JSON.stringify(n, null, 2));
