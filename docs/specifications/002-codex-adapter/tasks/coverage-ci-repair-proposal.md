# Proposed Node 24.22.1 coverage compatibility repair

Status: approved by the human on 2026-10-27: “Fix here”. Implementation row015-95. This is a spec 015 coverage defect found while validating the Codex candidate, not a Codex adapter defect.

Evidence: research/coverage-ci-node24.md. Main and candidate each pass 7/7 coverage tests on Node 24.21.0 and fail the same two on 24.22.1. Node retains an inline source-map URL but no parsed data after the recorder clears NODE_V8_COVERAGE to exclude children. Current mapping can use generated offsets against TypeScript and hash replacement disk text.

Proposed ownership: src/core/code/coverage/own.ts, CachedSourceMap in types.ts, a small adjacent inline-map parser if needed, focused test/code/coverage own-map/worker tests, and test/runners/node-test/coverage.test.ts. Inspect provider/key version requirements and include only required invalidation changes. Preserve recorder child exclusion; no external map fetch or late disk-map read as execution evidence.

Done when valid retained inline maps preserve original text and generated line lengths, while malformed, unsupported, identity-mismatched or textless transformed maps yield unread evidence. Plain untransformed sources retain their existing behavior. Direct mapper and actual mapping worker regressions pass. The unchanged adapter assertions pass on Node 24.21.0, 24.22.1 and supported Node 22. Lint, typecheck, build/version/key checks, affected tests, candidate review and exact-release CI remain mandatory.

One OpenAI implementation worker and one narrow reviewer can cover this bounded repair. Parent owns generated output and release. The already-reviewed fixed adapter should remain unchanged; any reason to change it must be reported before doing so.
