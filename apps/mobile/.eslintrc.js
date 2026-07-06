const rn = require('@crm/config/eslint/react-native');

module.exports = {
  ...rn,
  root: true,
  parserOptions: { ...(rn.parserOptions || {}), ecmaFeatures: { jsx: true } },
};
