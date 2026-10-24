# Probes for 016-05 ecosystem adoption

Throwaway. These files are the outputs of read-only queries to public registries on 2026-10-24, kept as evidence for `../../ecosystem-adoption.md`. Nothing here runs Squeal, a daemon or a harness. `count.sh` repeats the queries; it writes only under `/tmp/eco016`. The counts move daily, so a rerun gives other numbers.

| File | What it shows |
|---|---|
| `terraform-top100-by-tier.tsv` | The 100 most downloaded Terraform providers, grouped by registry tier: tier, count, summed downloads. |
| `vscode-testing-top25.tsv` | The 25 most installed VS Code Marketplace extensions in the Testing category: publisher, extension, installs. |
| `pytest-top15-owners.tsv` | The 15 most downloaded `pytest-*` packages on PyPI (top-pypi-packages, 30 days to 2026-10-01) and the repository each names. |
| `pypi-lint.tsv` | PyPI downloads in the same 30 days for pytest, nose, nose2, ruff, flake8, pylint. |
| `npm-eslint-jshint.txt` | npm monthly downloads of eslint, jshint and jscs at chosen months, 2015 to 2026. |
| `npm-biome.txt` | npm monthly downloads of eslint, prettier, @biomejs/biome and oxlint, September 2024 and September 2026. |
| `fetched-pages.log` | Every documentation page fetched for the findings, with its text size and the date. The hashicorp.com pages, the Biome GritQL reference, the Wallaby FAQ and the Marketplace license page came back blocked or empty and are not cited. |

Download counts include CI and mirrors. They show direction and order of magnitude, not users.
