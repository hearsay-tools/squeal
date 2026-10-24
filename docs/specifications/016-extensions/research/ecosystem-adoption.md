# 016-05 ecosystems and adoption: findings

Researcher: Claude Opus 5.5, 2026-10-24. Brief: `ecosystem-adoption-brief.md`. Pages were fetched on 2026-10-24 (list in `probes/ecosystem-adoption/fetched-pages.log`). Registry counts are from read-only queries the same day (`probes/ecosystem-adoption/`). Download counts include CI traffic: they give direction and size, not users.

## Questions answered

| # | Question | Answer in one line | Strength |
|---|---|---|---|
| 1 | Cases for | Plugins were the founding reason for ESLint and helped Vite and Terraform, but none of the cases isolates plugins from other causes. nose had plugins and still lost to pytest. | Moderate |
| 2 | Cases against | Ruff grew past flake8 and pylint with no third-party plugins. Its maintainer's stated reasons: bundling is the feature, and a public API freezes refactors. Biome and Deno held plugins back, then added narrow ones. Prettier limits options, not plugins. Wallaby states no reason. | Strong for Ruff |
| 3 | Cost | ESLint flat config: five years from RFC to release, slow ecosystem uptake, "too many breaking changes" in one major. pytest removes a deprecated hook only in a later major, after at least two minors. Policies that worked: long deprecation, codemods, two release lines, ecosystem CI. | Strong |
| 4 | Quality | Every large ecosystem ranks third parties by tier. Use concentrates in the top tier: official Terraform providers are 0.5% of providers and 83% of top-100 downloads. Conformance kits test contract shape, not result correctness. | Strong |
| 5 | Who writes them | Popular plugins move to the core team's org (12 of the top 15 pytest plugins) or come from vendors and framework teams. Agents produce integrations that pass a full test kit, but Squeal's own agent-written runners failed 22 of 34 reviews, some for stale passes. | Moderate |
| 6 | License | A closed or source-available core can hold an ecosystem (Sublime Text, Grafana's plugin catalog, VS Code's Marketplace), when the extension API, its SDK and the registry are open or permissive. A relicense of the core caused a fork (Terraform to OpenTofu); permissive provider and SDK licenses let the ecosystem move with it. | Moderate |

## Findings

### 1. Cases for

- **ESLint.** Its author created it because JSHint had "no easy way to add additional rules or to create your own"; "The goal of the project is to create a linting tool where all rules are pluggable" (Zakas, 2013-07-16). *read in official docs.* npm monthly downloads: January 2016, eslint 1.49M against jshint 2.05M; June 2016, 2.74M against 2.39M; January 2017, 4.84M against 2.24M; September 2026, 656M against 3.8M. *verified by experiment* (npm downloads API). 7,267 npm packages carry the keyword `eslint-plugin`. *verified by experiment.* The crossover in 2016 also matches ES2015 support, so the plugin effect is not isolated. *inferred.*
- **pytest.** The plugin list holds 2,016 active plugins. It "is not a curated collection". *read in official docs*, pytest stable, 2026-10-24. nose also had third-party plugins ("you will not be able to use third-party nose plugins" without setuptools) and lost because it was "in maintenance mode" without a maintainer. *read in official docs*, nose 1.3.7. PyPI 30 days to 2026-10-01: pytest 780M, nose 6.5M, nose2 0.5M. *verified by experiment.* So maintenance decided pytest against nose, not plugins alone. *inferred.*
- **Vite.** "Its plugin API, based on Rollup's conventions, made integration natural ... Nuxt, SvelteKit, Astro ... chose Vite as their foundation." The team runs `vite-ecosystem-ci`, "which tests major ecosystem projects against every Vite change." *read in official docs*, vite.dev/guide/why. Vite started with a plugin set it did not write: Rollup plugins work when they fit "an unbundled dev server". *read in official docs*, plugin API page.
- **Terraform.** Since 0.10.0 (2017-08-02) "providers are no longer distributed as part of the main Terraform distribution". *read in source code*, CHANGELOG at v0.10.0. The registry holds 7,546 providers. *verified by experiment.*
- **VS Code.** The Marketplace holds 122,624 extensions. *verified by experiment* (Marketplace query API). No maintainer account of growth was fetched; that the ecosystem drove adoption is *inferred* only.

Strength: every case is a correlation told by the winners. No case compares the same tool with and without plugins.

### 2. Cases against

- **Ruff** has no custom rules: "popular Flake8 plugins are re-implemented in Rust as part of Ruff itself"; a plugin system "is within-scope". *read in official docs*, Ruff FAQ, 2026-10-24. The meta issue #283 (2022-09-29) is still open, with 395 reactions. Charlie Marsh, 2023-01-25: "I do see the 'bundling' that's happening in Ruff as a feature and not a bug", rules share "economies of scale", and "As soon as we have non-Ruff code that depends on any sort of public API, we'll be far more limited in the kinds of changes and refactors we can make." On ports into core: "I'm signing up to be backstop maintainer." *read in source code* (GitHub issue API). PyPI downloads in 30 days: ruff 301M, flake8 40M, pylint 39M. *verified by experiment.* This is the strongest evidence in this file: a tool with no plugins overtook two tools with plugins in about four years.
- **Biome.** Roadmap 2024: "We don't know yet what a Biome's plugin will look like." v2.0 (2025-06-17) shipped GritQL plugins that "only allow you to match code snippets and report diagnostics", and "intentionally left out the distribution method". The current docs add JavaScript plugins, with a warning: "It's way easier to write a plugin that can negatively impact the performance of downstream users." *read in official docs.* npm monthly downloads of @biomejs/biome: 3.5M (2024-09) to 64M (2026-09). *verified by experiment.* Most of that growth came before plugins had a distribution method. *inferred.*
- **Prettier** limits options, not plugins: "Prettier has a few options because of history. But we won't add more of them." It lists four official and many community language plugins. *read in official docs.*
- **Deno lint** added a plugin API in Deno 2.2.0, "intentionally modeled after the ESLint API", still "evolving". *read in official docs.* Its earlier reasons were not fetched: not determined.
- **Wallaby** is commercial and supports Jest, Vitest, node:test, Mocha, Jasmine, Ava and Karma itself. It ships no third-party adapter API. *read in official docs.* No stated reason was found in the pages read: not determined.

### 3. Cost

- **ESLint v9 retrospective** (2025-05-21): "Nearly five years passed from initial flat config RFC to the final release." "The biggest mistake was bundling too many breaking changes into a single major release." "Ecosystem adoption was slow ... Many plugin and config authors didn't begin adapting their packages until v9.0.0 was in beta", after direct pull requests to typescript-eslint, eslint-plugin-react and others. Lessons: smaller majors, "Tooling first, documentation second", errors with context. The team kept v8 for six months and then handed it to a paid support vendor (HeroDevs). *read in official docs.*
- **ESLint semver policy** treats a change in results as a version event: a fix that reports fewer errors is a patch; a fix that reports more errors is a minor; plugin API changes are majors. It advises `~` pins "to guarantee the results of your builds." *read in source code*, eslint README, main, 2026-10-24.
- **pytest policy**: removal "only in major releases" and kept "for at least two minor releases"; at expiry the warning turns into an error for one minor; "True breakage" needs an issue with "Expected impact on users and plugin authors". *read in official docs.* Example: `py.path` hook arguments, deprecated in 7.0 and removed in 9.0. 41 removals are recorded on the deprecations page. *read in official docs.*
- **webpack 5** (2020-10-10): "shipping features without breaking changes also has a cost: We can't do major API or architectural improvements." "There is a good chance that upgrading fails and you would need to give it a second or 3rd try." *read in official docs.*
- **Babel 7** (2018-08-27): almost three years after 6, "over 50 pre-releases", a `babel-upgrade` codemod, and a move to the `@babel` scope that "helps differentiate official packages ... (and no squatting)". Its author ties Babel 6's "controversy and backlash" to "maintainer burnout (including Sebastian, Babel's creator)". *read in official docs.*
- **OpenTelemetry contrib** puts the cost on the contributor: "Unstable Collector interfaces may undergo breaking changes. Codeowners must be available to update ... otherwise the component will be excluded from the default builds." *read in source code*, `docs/new-components.md` at 87eb65f5.

Policies that worked, by these accounts: long deprecation windows, codemods, a supported previous major, and the core testing its main plugins on every change (vite-ecosystem-ci). *read in official docs.*

### 4. Quality

- **Terraform**: tiers Official (HashiCorp), Partner Premier, Partner ("written, maintained, validated and published by third-party companies against their own APIs"), Community and Archived. Releases need GPG signatures and SHA-256 sums. *read in official docs.* Registry counts: official 34, partner 394, community 7,103. In the top 100 by downloads: official 24 providers with 83% of downloads, partner 39 with 12%, community 37 with 5%. *verified by experiment.*
- **OpenTelemetry Collector contrib**: a new component needs a sponsor "from a different company than you", at least three codeowners, and a list of competing components. A component with no active code owner for 6 weeks is "unmaintained", and "After 3 months of being unmaintained, these components will be removed from official distribution." A vendor component with no vendor code owner is unmaintained. *read in source code*, at 87eb65f5.
- **VS Code Marketplace**: malware scanning before publication, secret scanning, signed packages checked at install, verified publishers (domain ownership and six months in good standing), a block list that uninstalls, and since 1.97 a publisher-trust prompt. *read in official docs.*
- **Grafana**: three signature levels (Private, Community, Commercial). Grafana may refuse to sign a plugin of "Niche use case or of limited value". *read in official docs*, grafana.com/legal/plugins.
- **pytest**: none for the list. The pytest-dev org is "a central location for popular pytest plugins" and shares "maintenance responsibility". *read in official docs.*
- **Conformance kits**: ESLint's RuleTester and Deno's plugin test helpers let authors test their own rules. *read in official docs.* None of the kits read check that a plugin reports correct results on real projects. Every quality gate above checks identity, integrity, maintenance or performance. None checks that results are true. For a test runner a false pass is a wrong result, and no ecosystem read has a gate that catches it. *inferred.*

### 5. Who writes them

- **pytest**: 12 of the 15 most downloaded `pytest-*` packages name a `github.com/pytest-dev/` repository; the other three are personal or company repositories. *verified by experiment* (top-pypi-packages to 2026-10-01, PyPI JSON).
- **VS Code Testing** category, top 25 by installs: platform and framework teams (Microsoft Java, the Go team, Dart-Code, ms-playwright, `vitest.explorer` by the Vitest team, Shopify's ruby-lsp) and vendors. One community runner (vscode-jest) is in the top 15. *verified by experiment*; classification *inferred*.
- **Terraform**: partner providers are written by the vendor of the API they wrap. *read in official docs.*
- **Agents against a spec and a test kit.** JustHTML (2025): an HTML5 parser written with coding agents that "passes 100% of the html5lib test suite"; its author: "choosing one that already has a lot of tests is a great idea", and an agent needs "a way for them to understand their own progress". *read in official docs* (author's blog; Willison, 2025-12-14). Anthropic's C compiler (2026-02-05): 16 agents, about 2,000 sessions, a 99% pass rate on the GCC torture suite; "it's important that the task verifier is nearly perfect, otherwise Claude will solve the wrong problem"; "New features and bugfixes frequently broke existing functionality"; for 16-bit x86 "Claude simply cheats here and calls out to GCC." *read in official docs.*
- **Squeal's own record.** Squeal's runners and harness adapters are written by agent workers against a spec and reviewed by another agent (`docs/process.md`, roles and steps 5 and 6). Specs 003 (node:test), 007 (pytest), 008 (OpenCode), 009 (Pi) and 013 (Vitest) hold 34 review files. 22 are FAIL. *read in source code*, `docs/specifications/*/reviews/`, HEAD 0822a444. node:test wave 2 failed on "a stale pass" through a computed `import()` in a preload. Waves 2.5 and 2.6 failed again on variants of it (quoted `NODE_OPTIONS`). *read in source code.* These were internal workers with the full repository and an adversarial reviewer. A third-party agent author has less. *inferred.*
- **Maintainers on agent work**: pytest now states "Purely agentic contributions are not accepted" and names the asymmetry: "someone is prioritizing what we review without making an equivalent investment". *read in official docs*, pytest contributing guide.

### 6. License

- **Closed or paid core, open ecosystem**: Sublime Text needs a paid license "for continued use". Package Control, a separate project, lists 5,746 packages and 25.56M users. *read in official docs.* Wallaby is closed and has no third-party ecosystem. *read in official docs.*
- **Open core, closed registry**: VS Code's source is MIT. Microsoft does "not license extensions from Microsoft ... for use outside of the Visual Studio family of products", and forks may not use the Marketplace. Open VSX (Eclipse Foundation) exists as the vendor-neutral registry. *read in official docs.*
- **Relicensed core, permissive API**: Grafana moved to AGPLv3 in 2021, and "Plugins, agents, and certain libraries will remain Apache-licensed". Today grafana is AGPL-3.0 and grafana-plugin-sdk-go is Apache-2.0. *read in official docs*; *verified by experiment* (GitHub license API). Terraform moved to BUSL on 2023-08-10. The OpenTofu manifesto: "the underpinnings of their infrastructure suddenly became a potential legal risk"; the fork followed on 2023-08-25. terraform-plugin-sdk, -framework, -go and terraform-provider-aws are still MPL-2.0. *read in official docs*; *verified by experiment.* With permissive provider licenses, the same providers serve both cores. *inferred.*
- **Squeal today**: `package.json` has `"private": true` and `"license": "UNLICENSED"`. No LICENSE file is in the repository root. *read in source code*, HEAD 0822a444. Under that license a third party has no grant to build against Squeal's types or to copy its runner code. *inferred*, not legal advice.

## Recommendation for Squeal

1. **Do not expect an open API to bring adoption by itself** (findings 1, 2). The evidence links growth to speed, bundling and active maintenance as often as to plugins. Ruff is the closest analogy to Squeal: a fast tool that bundles. It grew with no plugins at all. Treat extensions as a way to reach languages Squeal cannot cover alone, not as a growth engine.
2. **Delay the in-process code API; start with the narrowest tier** (findings 2, 3). Biome, Deno and Ruff started with a narrow, declarative or pattern tier and kept distribution open. ESLint and pytest show the cost of a broad code API: majors that take years and break plugins. A command plus an output format holds Squeal to the least.
3. **Version results, not only APIs** (finding 3). ESLint's semver treats "reports fewer/more errors" as a version event. Squeal's key format already moves only when the meaning of stored results changes (board rows 011-35 and 011-37). A third-party runner's version must enter the key the same way.
4. **Tier the extensions, and keep our own runners in the top tier** (findings 4, 5). Use counts show that users rely on the official tier. Our runners should sit behind the same public contract (the coordinator's assumption), but be marked official. A community runner's result should name its tier in status, so a false pass is attributed to it.
5. **Ship a correctness kit, not only a shape kit** (findings 4, 5). No ecosystem read has a gate for true results. Agents reach 99 to 100% on a good kit and "cheat" where it is weak. Squeal's own agent-written runners failed review on stale passes. A kit for runner authors should include fixture repositories with known failures, flips and invalidations, as the reviews used. Follow vite-ecosystem-ci: run the main extensions against every Squeal change.
6. **Adopt OpenTelemetry's maintenance rule for anything bundled** (finding 4): a named owner, and removal from the default set when unmaintained. Accept agent-written extensions only with an accountable human, as pytest does.
7. **Decide the license of the API before the API** (finding 6). An ecosystem can form around a closed core if the extension SDK, the types and the registry are open or permissive. While the whole repository is UNLICENSED, there is no grant at all. If the core may change license later, Grafana's split (core under one license, plugin SDK under Apache-2.0) is the precedent that kept its ecosystem.

## Limits and open questions

- No case isolates the effect of plugins on adoption. Downloads include CI and do not count users.
- Not determined: Deno's and Wallaby's stated reasons for no plugins, because no page read gives one.
- Not determined: how often third-party plugins in these ecosystems give wrong results, because no source measures it.
- The JustHTML and C compiler cases are rewrites against a fixed suite, not adapters to a moving tool. Squeal's reviews are a better analogy but come from one team.
- The license effect is read from four cases. Squeal's license choice is the human's, and needs legal review.

## Sources

Fetched 2026-10-24 unless dated.

- ESLint: https://humanwhocodes.com/blog/2013/07/16/introducing-eslint/ ; https://eslint.org/blog/2025/05/eslint-v9.0.0-retrospective/ ; https://github.com/eslint/eslint/blob/main/README.md (Semantic Versioning Policy); https://eslint.org/docs/latest/extend/custom-rules
- pytest: https://docs.pytest.org/en/stable/reference/plugin_list.html ; https://docs.pytest.org/en/stable/backwards-compatibility.html ; https://docs.pytest.org/en/stable/deprecations.html ; https://docs.pytest.org/en/stable/contributing.html ; nose: https://nose.readthedocs.io/en/latest/
- Ruff: https://docs.astral.sh/ruff/faq/ ; https://github.com/astral-sh/ruff/issues/283 (comments 1397295716, 1403025627)
- Biome: https://biomejs.dev/blog/roadmap-2024/ ; https://biomejs.dev/blog/biome-v2/ ; https://biomejs.dev/linter/plugins/
- Prettier: https://prettier.io/docs/option-philosophy ; https://prettier.io/docs/plugins
- Deno: https://docs.deno.com/runtime/reference/lint_plugins/
- Wallaby: https://wallabyjs.com/ ; https://wallabyjs.com/docs/integration/overview/
- Vite: https://vite.dev/guide/why ; https://vite.dev/guide/api-plugin
- webpack: https://webpack.js.org/blog/2020-10-10-webpack-5-release/ ; Babel: https://babeljs.io/blog/2018/08/27/7.0.0
- Terraform: https://developer.hashicorp.com/terraform/registry/providers ; https://developer.hashicorp.com/terraform/registry/providers/publishing ; https://github.com/hashicorp/terraform/blob/v0.10.0/CHANGELOG.md ; https://github.com/hashicorp/terraform/blob/main/LICENSE ; https://registry.terraform.io/v2/providers ; OpenTofu: https://opentofu.org/manifesto/
- OpenTelemetry: https://github.com/open-telemetry/opentelemetry-collector-contrib at 87eb65f5 (`CONTRIBUTING.md`, `docs/new-components.md`); https://github.com/open-telemetry/opentelemetry-collector/blob/main/docs/component-stability.md
- VS Code: https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security ; https://code.visualstudio.com/api/working-with-extensions/publishing-extension ; https://code.visualstudio.com/docs/supporting/faq ; Marketplace query API; Open VSX: https://www.eclipse.org/legal/open-vsx-registry-faq/
- Grafana: https://grafana.com/legal/plugins/ ; https://grafana.com/blog/2021/04/20/grafana-loki-tempo-relicensing-to-agplv3/
- Sublime Text: https://www.sublimehq.com/store/text ; https://packagecontrol.io/stats
- Agents: https://friendlybit.com/python/writing-justhtml-with-coding-agents/ ; https://simonwillison.net/2025/Dec/14/justhtml/ ; https://www.anthropic.com/engineering/building-c-compiler (2026-02-05)
- Registries: https://api.npmjs.org/downloads/ ; https://registry.npmjs.org/-/v1/search ; https://hugovk.github.io/top-pypi-packages/ (to 2026-10-01); https://pypi.org/pypi/<name>/json
- Squeal: `package.json`, `docs/specifications/{003,007,008,009,013}-*/reviews/` at HEAD 0822a444
- Probes: `probes/ecosystem-adoption/`
