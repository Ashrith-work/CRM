/** ESLint config for the Expo / React Native app. */
const base = require('./base');

module.exports = {
  ...base,
  env: { ...base.env, browser: true },
};
