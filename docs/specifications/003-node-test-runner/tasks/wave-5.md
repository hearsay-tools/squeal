# 003 wave 5 brief (2026-10-20)

One row, approved by the human on 2026-10-20 (triage gh-37, `docs/triage/2026-10-20-digest.md` group C). It runs beside 011-21 and 011-22 on disjoint files. Leave `docs/board.md`, `spec.md`, `status.md`, `package.json` versions and `plugins/*/dist` to the coordinator, and do not run `npm run build` in your tree.

## 001-365: no inputs advice for a node:test file whose inputs are declared

Use /worker. Shape: repair. Outcome: a node:test file whose declared `inputs` cover it gets no "declare it in inputs" advice; a file with no declared inputs still gets it. Silent suppression, the human's choice: no new wording.

Read: the board's 001-365 row; spec 003 D3 and D5; `../research/issue-37.md`; `../../005-agent-adoption/lessons.md` proposed row 3.

Seam: `bareNote` in `src/runners/node-test/adapter-project.ts:235`. Lead: pass it the project's declared inputs (find where the adapter receives the policy) and filter out files a declaration matches, before they enter `named`. First edit: a test under `test/runners/node-test/` with one bare file declared and one not; only the second is named.

Owns: `adapter-project.ts` and its tests. Leave alone: key coverage and how declared inputs reach a key (a declaration never proves every read is observed), the primer, other runners.

Done when: the test passes; lint, typecheck and `squeal run --all --wait` pass, its output pasted, any file that fails under load and passes alone named. If `adapter-project.ts` is a key-guarded source, raise `KEY_FORMAT_VERSION` as `test/keys/key-format.test.ts` asks and say so; the coordinator settles the number against 011-21 at integration.
