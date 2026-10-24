"""Counts MegaLinter linters that need a Python class, and how each counts errors."""
import collections, glob, sys, yaml

root = sys.argv[1]
count, modes, n, with_class = collections.Counter(), collections.Counter(), 0, 0
for f in glob.glob(root + "/megalinter/descriptors/*.megalinter-descriptor.yml"):
    for linter in yaml.safe_load(open(f)).get("linters", []):
        n += 1
        with_class += bool(linter.get("class"))
        count[linter.get("cli_lint_errors_count", "(default: exit status)")] += 1
        modes[linter.get("cli_lint_mode", "file")] += 1
print("linters", n, "with python class", with_class)
print(dict(count))
print(dict(modes))
