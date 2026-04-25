/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  extends: [require.resolve('@getyn/config/eslint/base')],
  ignorePatterns: ['.eslintrc.js'],
};
