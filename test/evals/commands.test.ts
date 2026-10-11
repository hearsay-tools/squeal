import { describe, expect, it } from "vitest";
import { classifyShell, simpleCommands } from "../../evals/lib/index.mjs";

const kinds = (text: string) => classifyShell(text).map((a) => a.kind);
/** The actions without their execution, which `execution.test.ts` covers. */
const shapes = (text: string, exit = 0) =>
  classifyShell(text, { exit }).map(({ execution: _, ...a }) => a);

describe("simpleCommands", () => {
  it("splits chains, pipes and subshells into their commands, a substitution first", () => {
    const words = simpleCommands(
      "cd x && (npx vitest run | tail -5); sleep 2 || echo $(squeal status)",
    ).map((c) => c.words);
    expect(words).toEqual([
      ["cd", "x"],
      ["npx", "vitest", "run"],
      ["tail", "-5"],
      ["sleep", "2"],
      ["squeal", "status"],
      ["echo"],
    ]);
  });

  it("unwraps Codex's bash -lc wrapper, with its quoted single quotes", () => {
    const cmd = `/bin/bash -lc 'squeal why "the year'"'"'s ledger" && npx vitest run'`;
    expect(simpleCommands(cmd).map((c) => c.words)).toEqual([
      ["squeal", "why", "the year's ledger"],
      ["npx", "vitest", "run"],
    ]);
    expect(
      simpleCommands(`bash -c "FOO=1 timeout 60 npx vitest run \\"test/a b.test.ts\\""`)[0]?.words,
    ).toEqual(["npx", "vitest", "run", "test/a b.test.ts"]);
  });

  it("keeps a redirect's fd duplication apart from a file target", () => {
    const [c] = simpleCommands("npx vitest run 2>&1 > out.txt");
    expect(c?.words).toEqual(["npx", "vitest", "run"]);
    expect(c?.redirects).toEqual([{ op: ">", target: "out.txt" }]);
  });

  it("reads a heredoc as the command's body, never as commands", () => {
    const cs = simpleCommands("cat > src/a.ts <<'EOF'\nnpx vitest run\nEOF\nsqueal status");
    expect(cs.map((c) => c.words)).toEqual([["cat"], ["squeal", "status"]]);
    expect(cs[0]?.heredocs).toEqual(["npx vitest run"]);
  });
});

describe("classifyShell", () => {
  it("names each Squeal call with its flags, however the CLI is spelled", () => {
    expect(shapes('node "/pin/plugins/codex/dist/cli/squeal.mjs" status --wait 60000')).toEqual([
      { kind: "squeal", sub: "status", wait: true, all: false, slow: false },
    ]);
    expect(shapes("squeal run --slow && squeal status --wait 90000")).toEqual([
      { kind: "squeal", sub: "run", wait: false, all: false, slow: true },
      { kind: "squeal", sub: "status", wait: true, all: false, slow: false },
    ]);
  });

  it("does not count a script, a type check or a test command inside quoted text as a run", () => {
    expect(kinds("node scripts/changelog.mjs")).toEqual([]);
    expect(kinds("npx --no-install tsc --noEmit")).toEqual([]);
    expect(kinds('grep -rn "npx vitest run" README.md')).toEqual([]);
    expect(kinds("npm run test:other")).toEqual([]);
  });

  it("counts sleeps and the files a command writes", () => {
    expect(shapes("sleep 20; squeal status --wait 60000")[0]).toEqual({
      kind: "sleep",
      seconds: 20,
    });
    expect(shapes("sed -i 's/a/b/' src/clock.ts test/clock.test.ts")).toEqual([
      { kind: "write", path: "src/clock.ts" },
      { kind: "write", path: "test/clock.test.ts" },
    ]);
    expect(shapes("echo x | tee -a changes.json > /dev/null")).toEqual([
      { kind: "write", path: "changes.json" },
    ]);
    expect(
      shapes(
        "apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: test/contract/x.test.ts\nPATCH",
      ),
    ).toEqual([{ kind: "write", path: "test/contract/x.test.ts" }]);
    expect(kinds("sed -n 1,20p src/clock.ts")).toEqual([]);
  });
});
