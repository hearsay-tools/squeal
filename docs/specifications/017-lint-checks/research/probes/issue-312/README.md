# Issue 312 throwaway probe

`format.ts` calls the real CLI and status formatters with synthetic completed lint state. It starts no daemon or linter. Run from the repository root:

```sh
pnpm exec tsx docs/specifications/017-lint-checks/research/probes/issue-312/format.ts
```

It reproduces the missing tool name in aggregate text and provides a positive oxlint finding control. It does not reproduce the reporter's repository or CI failure.
