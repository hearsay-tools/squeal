# Issue 244 classifier probe

Throwaway research fixture, not a product test. From the repository root:

```sh
node docs/specifications/023-results-at-commit/research/probes/issue-244/classifier.mjs
```

Imports the production classifier directly using Node's TypeScript stripping.
Supplies synthetic recorded errors shaped like issue 244 and controls. Starts no
browser, runner, daemon, checkout or install. `greenEligible` is the real predicate
used by the CLI, not an observation of a real green-side invocation. The passing
green supplied for assertion controls is synthetic.

Examined with Node 26.13.0 and Squeal 0.1.563 at
`cddea9e124e7cc09ea231819a031d94a46254d81` on 2026-11-18.
