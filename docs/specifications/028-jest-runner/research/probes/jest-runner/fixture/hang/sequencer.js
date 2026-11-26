// Runs files in name order so the hang comes after two completed files.
const Sequencer = require('@jest/test-sequencer').default;
module.exports = class extends Sequencer {
  sort(tests) { return [...tests].sort((a, b) => a.path.localeCompare(b.path)); }
};
