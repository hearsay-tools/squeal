# Issue 11: subcommand help reproduction

Use /researcher. Shape: research. Reproduce [GitHub issue #11](https://github.com/hearsay-tools/squeal/issues/11), agent-reported friction on Squeal 0.1.199: `node <plugin>/dist/cli/squeal.mjs run --help` rejects the flag with exit 2. Requested: subcommand help lists supported flags, exits 0 and starts no work.

Read docs/vision.md decision filter, spec 005 D2/D3/D6 and its status.md. Start at `src/cli/index.ts`; inspect dispatch before invoking any potentially mutating command. Run the installed 0.1.199 CLI and committed checkout bundle for `run --help`, with root `--help` as control; record exact commands, stdout, stderr, exit codes, versions and commit. Use an isolated temporary directory if needed. Do not run actual validation or install anything. Do not implement a fix. Note any relevant parser evidence and limits of the reproduction.

Own only `docs/specifications/005-agent-adoption/research/issue-11.md`; leave board, spec, status and product code untouched. Done when that concise evidence report is committed. No product checks are needed for a report-only change. Reply with the commit and reproduction verdict.
