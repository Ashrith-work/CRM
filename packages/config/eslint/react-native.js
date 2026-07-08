/** ESLint config for the Expo / React Native app. */
const base = require('./base');

module.exports = {
  ...base,
  env: { ...base.env, browser: true },
  // Register react-hooks so the `react-hooks/exhaustive-deps` disable comments in
  // the app resolve (otherwise ESLint errors: "rule definition not found").
  plugins: [...(base.plugins || []), 'react-hooks'],
  rules: {
    ...base.rules,
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
};
