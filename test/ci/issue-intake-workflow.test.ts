import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The workflow's security contract, read as text (spec 010 D12). Ported from
// cezarion's issue-intake.workflow.test.cjs at 10cec2e9, Jev path only.
const workflow = readFileSync(
  join(import.meta.dirname, "..", "..", ".github", "workflows", "issue-intake.yml"),
  "utf8",
);

function job(name: string): string {
  const match = workflow.match(
    new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [\\w-]+:\\n|(?![\\s\\S]))`, "m"),
  );
  if (!match) throw new Error(`expected the ${name} job`);
  return match[0];
}

function step(source: string, name: string): string {
  const start = source.indexOf(`- name: ${name}`);
  if (start < 0) throw new Error(`expected the step ${name}`);
  const next = source.indexOf("\n      - name: ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("issue-intake.yml", () => {
  it("runs on opened issues with no default permissions and only the two jobs", () => {
    expect(workflow).toMatch(/^name: Issue Intake$/m);
    expect(workflow).toMatch(/^on:\n {2}issues:\n {4}types: \[opened\]$/m);
    expect(workflow).toMatch(/^permissions: \{\}$/m);
    const jobs = [...workflow.matchAll(/^ {2}([\w-]+):\n/gm)].map((match) => match[1]);
    expect(jobs).toEqual(["issues", "jev-intake", "apply-intake"]);
    expect(workflow).not.toMatch(/ANTHROPIC_API_KEY|OPENAI_API_KEY|ISSUE_INTAKE_PROVIDER/);
  });

  it("pins every action to a commit", () => {
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/);
  });

  it("gives the Jev job read access, the key and nothing else", () => {
    const jev = job("jev-intake");
    expect(jev).toMatch(/permissions:\n {6}contents: read\n {6}issues: read\n\n/);
    expect(jev).not.toMatch(/: write/);
    expect(jev).toMatch(/persist-credentials: false/);
    const secrets = [...jev.matchAll(/secrets\.(\w+)/g)].map((match) => match[1]);
    expect(secrets).toEqual(["TYPESAFE_API_KEY"]);
    expect(workflow.match(/secrets\./g)).toHaveLength(1);
    expect(step(jev, "Run Jev issue triage")).toMatch(
      /node \.github\/scripts\/jev-issue-intake\.cjs \.issue-intake-context intake-output\/intake\.json/,
    );
    expect(jev).toMatch(
      /name: intake-output\n\s+path: intake-output\/intake\.json\n\s+if-no-files-found: error/,
    );
  });

  it("rejects untrusted bots before the billable call", () => {
    const jev = job("jev-intake");
    expect(jev).toMatch(/\[\[ "\$ACTOR" == \*'\[bot\]' && "\$ACTOR" != 'claude\[bot\]' \]\]/);
    expect(jev.indexOf("name: Reject untrusted bot actors")).toBeLessThan(
      jev.indexOf("name: Run Jev issue triage"),
    );
  });

  it("builds candidates from open and recently closed issues, in the file Jev reads", () => {
    const fetch = step(job("jev-intake"), "Fetch issue context");
    expect(fetch).toMatch(/issues\?state=open&per_page=100/);
    expect(fetch).toMatch(/issues\?state=closed&since=\$\{since\}&per_page=100/);
    expect(fetch).toMatch(/since="\$\(date -u -d '30 days ago' /);
    expect(fetch).toMatch(/\{number,title,body,labels,updated_at,closed_at\}/);
    expect(fetch).toMatch(
      /node \.github\/scripts\/issue-intake-candidates\.cjs \.issue-intake-context\/issue\.json \\\n\s+"\$RUNNER_TEMP\/open-issues\.raw\.json" "\$RUNNER_TEMP\/closed-issues\.raw\.json" \\\n\s+> \.issue-intake-context\/candidates\.json/,
    );
    expect(job("jev-intake").indexOf("name: Fetch issue context")).toBeLessThan(
      job("jev-intake").indexOf("name: Run Jev issue triage"),
    );
  });

  it("keeps the applicator the only writer, with no secrets", () => {
    expect(workflow.match(/^ +issues: write$/gm)).toHaveLength(1);
    const apply = job("apply-intake");
    expect(apply).toMatch(/permissions:\n {6}contents: read\n {6}issues: write\n/);
    expect(apply).not.toMatch(/secrets\./);
    expect(apply).toMatch(/needs: jev-intake\n/);
  });

  it("applies only after Jev succeeded, rebuilding the candidate set with open flags", () => {
    const apply = job("apply-intake");
    for (const name of [
      "Checkout trusted applicator",
      "Download intake output",
      "Apply intake mutations",
    ]) {
      expect(step(apply, name), name).toMatch(
        /if: \$\{\{ needs\.jev-intake\.result == 'success' \}\}/,
      );
    }
    const script = step(apply, "Apply intake mutations");
    expect(script).toMatch(/require\('\.\/\.github\/scripts\/apply-issue-intake\.cjs'\)/);
    expect(script).toMatch(/require\('\.\/\.github\/scripts\/issue-intake-candidates\.cjs'\)/);
    expect(script).toMatch(/state: 'closed', since: closedSince\(now\)/);
    expect(script).toMatch(
      /buildCandidates\(\{ issue, openIssues, closedIssues,.*max: Infinity \}\)/,
    );
    expect(script).toMatch(/candidate\.number, candidate\.open/);
    expect(script).toMatch(/planIntakeMutations\(\{[^}]*candidateOpen, closeDuplicates/);
  });

  it("closes only when ISSUE_INTAKE_CLOSE_DUPLICATES is exactly true", () => {
    const script = step(job("apply-intake"), "Apply intake mutations");
    expect(script).toMatch(/CLOSE_DUPLICATES: \$\{\{ vars\.ISSUE_INTAKE_CLOSE_DUPLICATES \}\}/);
    expect(script).toMatch(/const closeDuplicates = process\.env\.CLOSE_DUPLICATES === 'true';/);
  });

  it("marks every issue left open for triage as the last step, whatever failed before", () => {
    const apply = job("apply-intake");
    expect(apply).toMatch(/^ {4}if: \$\{\{ always\(\) \}\}$/m);
    const last = step(apply, "Mark the issue for triage unless intake closed it");
    expect(apply.trimEnd().endsWith(last.trimEnd())).toBe(true);
    expect(last).toMatch(/if: \$\{\{ always\(\) \}\}/);
    expect(last).toMatch(/--json state --jq \.state/);
    expect(last).toMatch(
      /if \[ "\$state" = 'OPEN' \]; then\n\s+gh issue edit "\$ISSUE" --repo "\$GITHUB_REPOSITORY" --add-label needs-triage/,
    );
    expect(workflow.match(/needs-triage/g)?.length).toBeGreaterThanOrEqual(1);
    expect(workflow).not.toMatch(/add-label needs-triage[\s\S]*add-label needs-triage/);
  });

  it("passes event data to scripts through env, never interpolated into run", () => {
    for (const match of workflow.matchAll(/run: \|\n([\s\S]*?)(?=\n {6}- |\n\n|$)/g)) {
      expect(match[1]).not.toMatch(/\$\{\{/);
    }
    expect(workflow).not.toMatch(/github\.event\.issue\.(title|body)/);
  });
});
