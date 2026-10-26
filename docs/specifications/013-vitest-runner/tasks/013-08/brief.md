# Repair coverage-provider loading on Cezar

Use /worker. Shape: repair. Outcome: identify and fix the real provider load fault; Cezar tests complete with coverage enabled.

Read 013 V1/V4/V8, status.md; 015 D8; 011 research/cezar-posttooluse.md coverage section and main-pull-checkpoint.md. Start at src/runners/vitest/reporter.ts:errorText: preserve nested error causes in run diagnostics, regression first. Then reproduce the failing provider load on Vitest4.1.10 (Cezar) and fix its cause, not just the wrapper. Both installed .341 and retained .342 provider paths failed; most workers in the same runs passed.

Own src/runners/vitest/, test/runners/vitest/, src/core/code/coverage/provider.mjs, matching coverage-provider tests, and this task folder’s notes/probes. No board/spec/status/bundles/version edits. Other workers own src/core/code/crap/ and lint; leave them alone. Ask parent before extending core scheduler or ownership.

Targeted reproduction is authorized, including an isolated Cezar scratch checkout. Do not edit live plugin caches, installed dependencies or other task’s checkout; no full suite. Do not run npm run build in worker. Use Squeal affected checks, lint/typecheck, and explicit scoped external reproduction when daemon does not cover it.

Done: exact nested cause captured with evidence; regression fails without fix and passes with it; bounded Cezar reproduction passes with coverage on; diagnostics retain causes safely (cycles bounded). Commit diagnostic change separately before root fix; send parent the cause as soon as captured. If capture needs a temporary runtime in parent, provide exact command and artifact instead of stopping.
