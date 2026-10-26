# Wave 2.5: candidate repairs

Every brief retains these rules: test keys against what the tool actually read; test an edit between two steps; fix a known wrong-result gap before review; real ESLint checks run on Node 22.19 (`/home/agent/.nvm/versions/node/v22.19.0/bin`). Use affected checks, no full suite/checkpoint or worker build. Commit notes and changes; do not edit board/status, versions or bundles.

## 017-11.R1: no-runner CI failure

Use /worker. Shape: repair. Diagnose and fix candidate CI 40419094538, job 121908710503: `test/daemon/composite-runner.test.ts`, "keeps the Vitest note when neither runner is configured or detected". It expects `vitest could not start: vitest/node does not resolve`; the only received note is the missing coverage-provider note. Other 91 Node 24 files passed.

Start at the test's `waitReady`/`readNotes` seam: establish whether ready precedes note publication or pnpm lets Vitest resolve from the fixture. Own this test and narrowly needed test helper only; request before changing product. Preserve the original assertion and prove the no-runner fixture has no runner. Include a regression for the proven cause rather than weakening the check. Lint, typecheck and targeted evidence on Node 22.19 and Node 24. Commit notes to tasks/017-11-r1/notes.md.
