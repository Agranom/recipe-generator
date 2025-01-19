module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  ignorePatterns: ['load-testing', 'dist/*'],
  extends: [
    'eslint:recommended',
    "plugin:@typescript-eslint/recommended",
    'prettier'
  ],
  env: {
    node: true
  },
  rules: {
    "@typescript-eslint/no-explicit-any": "warn"
  },
  parserOptions: {
    tsconfigRootDir: __dirname
  }
};
