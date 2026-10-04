# Watcher fixtures

`basic/` is copied into a temporary directory, `_gitignore` is renamed to `.gitignore`, and the copy becomes a git repository with one commit. The file is stored as `_gitignore` so it does not apply to this repository. `out/gen.js` stands for generated code that a closure references although it is ignored.
