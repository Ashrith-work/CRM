/** ESLint config for the NestJS backend. */
const base = require('./base');

module.exports = {
  ...base,
  env: { ...base.env, jest: true },
  rules: {
    ...base.rules,
    // Nest relies heavily on decorators + DI; these defaults are noisy there.
    '@typescript-eslint/no-extraneous-class': 'off',
  },
};
