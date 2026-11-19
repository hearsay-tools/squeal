// Row 023-25 probe: the installed-dependency reading of a tree (fingerprint, note, graph).
const [sq, ...trees] = process.argv.slice(2);
const { installedDependencies } = await import(`${sq}/dist/core/keys/environment.js`);
for (const tree of trees) {
  const d = await installedDependencies(`${tree}/packages/cezar`, tree);
  console.log(tree, d.fingerprint, d.graph === null ? "graph: null" : "graph: yes", d.note);
}
