const nest = require('@crm/config/eslint/nest');

module.exports = {
  ...nest,
  root: true,
  parserOptions: { ...(nest.parserOptions || {}), project: false },
};
