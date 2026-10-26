# Keep coverage from separate project roots

Use /worker. Shape: repair. Continue after 013-08 on worker 6b240e54.

Read 015 D8 and worker request f11b126c. Own src/runners/vitest/coverage.ts, matching coverage tests and this task folder; do not edit board/spec/status/bundles. First regression: separate-project config reports test file names relative to project root and current coveredFiles resolves against worktree, dropping records. Resolve against recorded project.config.root. Keep absolute paths; distinguish duplicate relative test paths in different projects; assert actual source/test/project identities. Commit separately. Done when regression fails before, passes after, and Cezar coverage records survive, with lint/typecheck and affected verdict. No full suite or worker build.
