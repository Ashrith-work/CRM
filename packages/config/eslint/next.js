/** ESLint config for the Next.js web app. */
const base = require('./base');

module.exports = {
  ...base,
  env: { ...base.env, browser: true },
};
