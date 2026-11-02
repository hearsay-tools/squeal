# 0005. Use tsrs for repository checks and builds

Date: 2026-11-02
Status: accepted (the human: "Verify and adopt it then")

## Context

The repository uses TypeScript 7.0.2 for type checks, compilation and private CLI builds in tests. Eight interleaved measurements per case on a busy 24-CPU host found that tsrs fast mode reduces typecheck time from 5.00 to 2.01 seconds and compilation from 2.16 to 0.78 seconds. Typecheck peak RSS falls from 1,366 to 374 MiB. Total CPU time falls by 62% for typechecks and 71% for compilation. Against the exact upstream TypeScript 7.1 beta commit that tsrs ports, the speedups are 2.14 and 2.19 times.

The measurements are preserved in Cezar task `7803aae0-143a-45b2-bb67-d9e96875c712`, report artifact `109270fc-c308-4484-b148-79a53878fef5`, raw results artifact `25bfe8cf-365d-48d3-bd4d-58db6e5f5d0f`. These are compiler measurements, not full build or CI measurements.

## Decision

- Pin `tsrs` to the measured `0.20.1-ts7.1.0-beta` release. Use `--fast` for repository typechecks, compilation and test helpers that compile the private CLI. CI calls the repository typecheck script.
- Keep the official TypeScript dependency as a compatibility reference. Fixtures that model a user's `tsc` build keep modelling that tool.
- The new compiler and matching upstream beta report three implicit-any diagnostics on destructured delivery options. Annotate those parameters with their existing public option types. Do not weaken compiler settings or suppress the diagnostics.
- Preserve `--listFiles` observation in native compiler test builds, including failed builds. Setup recognizes tsrs build scripts when finding the configured output directory, as it recognizes tsc.
- Verify typecheck, lint, compiler output, plugin build drift and affected tests. A candidate review must pass before main. This decision does not change the full-suite or release rules.

## Alternatives considered

Keeping TypeScript 7.0.2 preserves the current compiler, but uses more CPU and memory in the measured work. Bun can transpile TypeScript but does not supply these typechecks or declaration emission. Default tsrs mode is compatible with the matching upstream compiler here, but fast mode gives larger time savings. Fast mode documents diagnostic differences on some programs, so the version is pinned and upgrades need verification.

## Consequences

The repository adopts a beta compiler port. The benchmark found identical diagnostics and all 2,544 emitted files identical to matching upstream TS7.1 beta. Compared with TS7.0.2, JavaScript and declarations match and source maps differ. This is evidence for this checkout, not general conformance. Background Vitest and coverage load is unchanged by the compiler switch.
