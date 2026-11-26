// Throwaway probe (spec 028 research). Prints the jest-runtime a project's Jest
// uses, following jest -> jest-cli -> @jest/core -> jest-runner -> jest-runtime,
// so it works in pnpm layouts where jest-runtime is not hoisted.
const path = require('path');
let from = process.argv[2];
for (const name of ['jest', 'jest-cli', '@jest/core', 'jest-runner', 'jest-runtime']) {
  from = path.dirname(require.resolve(`${name}/package.json`, { paths: [from] }));
}
console.log(from);
