// Throwaway probe for 023-10, run as squeal-e2e in clone s5 (squawk at 0dfe0724c). Not product code.
// feb856667's defect as two commits, exactly as test/e2e/at-commit-proof.test.ts builds it:
// base = the test's run environment lets the workflow's GITHUB_RUN_ATTEMPT through and does not
// pin it; HEAD = the real file.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const test = "scripts/release-identity.test.mjs";
const fixed = readFileSync(test, "utf8");
const old = fixed
  .replace("GITHUB_|ACTIONS_ID_TOKEN_", "GITHUB_ACTIONS$|ACTIONS_ID_TOKEN_")
  .replace("GITHUB_RUN_ATTEMPT: '1', ", "");
if (!old.includes("GITHUB_ACTIONS$|ACTIONS_ID_TOKEN_") || old.includes("GITHUB_RUN_ATTEMPT: '1', "))
  throw new Error("the fixture edits did not apply");
const git = (...a) => execFileSync("git", a, { stdio: "inherit" });
writeFileSync(test, old);
git("commit", "-qam", "test(release): build identity test runs with the workflow's environment");
writeFileSync(test, fixed);
git("commit", "-qam", "fix(release): pin GITHUB_RUN_ATTEMPT so CI re-runs stop failing the identity test");
