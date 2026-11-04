# Expression arrow coverage fixture

`coverage.json` comes from Vitest 4.1.10 with its V8 provider. Only the absolute
report key and `path` were changed to `source.ts`. Null end columns are preserved.
The fixture calls `single` twice, `multi` once and `unused` zero times. It also calls `f` once through a
parenthesized type assertion on its receiver, which calls `g` once.

Regenerate from the repository root:

```sh
npm test -- --config "$PWD/.ai/skills/check-code-quality/scripts/fixtures/expression-arrows/vitest.config.ts" \
  --root "$PWD/.ai/skills/check-code-quality/scripts/fixtures/expression-arrows" \
  --coverage --coverage.include=source.ts --coverage.reporter=json \
  --coverage.reportsDirectory=coverage
```

Copy
`.ai/skills/check-code-quality/scripts/fixtures/expression-arrows/coverage/coverage-final.json`
to `.ai/skills/check-code-quality/scripts/fixtures/expression-arrows/coverage.json`.
Replace only the absolute report key and `path` with `source.ts`.
