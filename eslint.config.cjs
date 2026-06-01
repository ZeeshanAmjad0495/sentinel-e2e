const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.eslint.json', './examples/web-erpnext/tsconfig.json'],
        tsconfigRootDir: __dirname,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // Core correctness
      'no-console': 'off',
      'no-debugger': 'error',

      // TypeScript best-practices (strict but sane)
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

      // Style kept mostly to Prettier; don't fight formatting in ESLint.
    },
  },
  {
    // SEAM boundary: app/flow/component code must not import Playwright.
    files: ['**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              message:
                'Playwright is confined to @sentinel/driver-playwright and test-runner dirs.',
            },
            {
              name: 'playwright',
              message:
                'Playwright is confined to @sentinel/driver-playwright and test-runner dirs.',
            },
          ],
        },
      ],
    },
  },
  {
    // Exemption (last match wins): the driver adapter + all test-runner dirs
    // and the Playwright runner config files (test-runner tooling).
    files: [
      'packages/driver-playwright/**/*.ts',
      'packages/**/tests/**',
      'examples/web-erpnext/tests/**',
      'playwright.unit.config.ts',
      'examples/web-erpnext/playwright.config.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    // TEMPORARY (S1 → removed in S4): the migrated auth slice is still the
    // OLD Playwright-coupled version. Its rewrite onto @sentinel/driver-playwright
    // happens in S4, which deletes this block. Until then, exempt the moved
    // app/flow/component code from the Playwright import ban.
    files: ['examples/web-erpnext/src/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  eslintConfigPrettier,
];
