# Issue 242 probe

Throwaway research fixture. Run from the repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-242/probe.ts
```

The script calls the production selection decision function with synthetic input.
It starts no daemon or test runner, opens no store and writes no product files.
`output.txt` records the run; `help.txt` records installed 0.1.560's status help.
The findings file names the source commit and the comparison with release 0.1.560.
