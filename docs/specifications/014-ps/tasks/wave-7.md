# 014 wave 7: after `shipped`

Spec 014 shipped in 0.1.258 (2026-10-22). One row: the scan the coordinator skill runs after a spec ships. The evals of `docs/process.md` 6b run beside it, by the coordinator. Worker: `--runner claude --model opus --effort xhigh`.

## 014-40 quality scan over spec 014

Use /quality. Shape: survey. **Outcome:** one findings file, `docs/specifications/014-ps/quality/2026-10.md`, with drop candidates, rows and slices for 014's landed work. **Range:** `dba977e48` (014-04, first in 0.1.237) to `253c45ead` (0.1.258): `src/core/ps/`, `src/cli/ps.ts`, `src/cli/ps-index.ts`, `test/ps/`, `test/e2e/ps*`, `test/harness/ps-bundle.test.ts`, and the spec's own files. **Read:** `docs/vision.md`, `docs/styleguide.md`, `spec.md`, `status.md` (its shipped line names the accepted limits), `lessons.md`. **Inputs the coordinator names:** `flags-leftovers.ts` is 333 lines; the `shape.ts:106` comment nit of `reviews/wave-6.md`; two comments still name goal 6's 0.3 s (`flags-leftovers.ts:33`, `ps-index.ts:8`), now 0.4 s; row 014-36, about 60 `squeal-*` `mkdtemp` prefixes in `src/` and `test/` that `leftover-temp` does not name, which needs a design choice. **Owns:** the findings file only. Never edit the board, `status.md` or product code. **Done when:** the findings file is committed, and each finding has `file:line` evidence and a proposed row, slice or drop.
