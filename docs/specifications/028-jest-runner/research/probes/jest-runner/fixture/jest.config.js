// Throwaway fixture (spec 028 research). Observation probe project.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.js'],
  moduleNameMapper: {
    '^@lib/(.*)$': '<rootDir>/lib/$1',
    '\\.css$': '<rootDir>/lib/styleMock.js',
  },
  setupFiles: ['<rootDir>/lib/setup-env.js'],
  setupFilesAfterEnv: ['<rootDir>/lib/setup-after.js'],
};
