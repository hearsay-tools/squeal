# Research brief 016-05: ecosystems and adoption

Use /researcher. Shape: research. Outcome: evidence on whether opening a tool to extensions drove its adoption, what it cost its maintainers, and how ecosystems keep the quality of what third parties ship. Follow the rules in `README.md`. Mechanisms are 016-02's; read them only as far as a case needs.

Read first: `docs/vision.md` (who it is for, success, decision filter); `package.json` (`private`, `license`).

Questions:

1. **Cases for.** Tools whose ecosystem drove their growth (for example pytest against unittest and nose, ESLint against JSHint and JSLint, Vite on Rollup's plugins, Terraform providers, VS Code). For each: the evidence (plugin counts, maintainers, dates, maintainers' own accounts) and how strong it is.
2. **Cases against.** Tools that grew without plugins or held them back (Ruff, Biome before its plugins, Prettier's restraint, Deno lint, Wallaby). Their reasons, in their own words.
3. **Cost.** What a public plugin API cost: breaking changes and migrations (ESLint flat config, webpack 5, Babel 7, pytest hook removals), support load, versioning policies that worked.
4. **Quality.** How ecosystems keep a bad plugin from harming the product's name: official against community packages, verified publishers, signing, conformance kits, curated lists (Terraform verified providers, OpenTelemetry contrib, VS Code, Grafana). For Squeal a false pass is the worst harm.
5. **Who writes them.** Framework maintainers, users or vendors? Evidence for integrations written by coding agents against a specification and a test kit, and how good they were.
6. **License.** Can an ecosystem form around a closed or source-available core? Examples both ways, and what the license of the extension API itself did.

Own `ecosystem-adoption.md` and `probes/ecosystem-adoption/`.
