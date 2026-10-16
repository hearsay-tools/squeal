#!/bin/sh
# Throwaway (issue 10 research). Prints the edited unit test's state at fixture
# $1 from `squeal status --json` with Squeal CLI $2: revision, whether it has
# current checks, and its unknown entry (ran, reason head) if any.
cd "$1" && node --disable-warning=ExperimentalWarning "$2" status --json | node -e '
let s=""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const j = JSON.parse(s); const p = "packages/web/src/lib/nav-contract.test.ts";
  const u = (j.unknownTestFiles?.files ?? []).find((f) => f.testFile.path === p);
  console.log(JSON.stringify({ revision: j.revision, filePass: j.breakdown.fileLevelByOutcome.pass,
    unknown: u ? { ran: u.ran, reason: (u.reason ?? "").slice(0, 90) } : null }));
});'
