# 002-42: coverage CI comparison

Use /researcher. Shape: research, bounded to 20 minutes. Explain two Node 24.22.1 failures in test/runners/node-test/coverage.test.ts at candidate 9401c1d08: line219 area coverage received4/4 versus3/4; line249 original-text blob expected619c64d849227598d84b34b98604bab17e631d1b, received2f833eedad2b85b5e3dad64fd1b0776863b60da4. CI40513866109 job122222539571. Product coverage paths are unchanged from main40259a9e4; that alone proves no cause.

Own research/coverage-ci-node24.md and optional research/probes/coverage-ci-node24/. No product, tests, generated files, versions or shared-doc edits. Read coverage spec015 and its row015-86 evidence as needed.

Compare this candidate and main40259a9e4 using installed Node24.21.0 and24.22.1 under /home/agent/.nvm/versions/node/. Explicit focused runs are authorized for this environment comparison; no full suite. Use isolated scratch inputs and preserve exact runtime, source text/blob and mapping observations. Avoid concurrent experiments that share fixture state.

Done when evidence distinguishes runtime regression, test assumption, fixture race, or an unresolved cause with the next smallest experiment. Recommend bounded repair ownership; do not implement it. Commit findings with commands and actual results, then clean your scratch processes/worktrees.
