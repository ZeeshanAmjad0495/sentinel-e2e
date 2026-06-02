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
    // DRIVER-AGNOSTIC boundary (slice B): @sentinel/ai analyzer source must
    // import NO driver — neither Playwright nor any @sentinel/driver-* package.
    // Tests under packages/ai/tests/** keep the test-runner exemption below.
    files: ['packages/ai/src/**/*.ts'],
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
          patterns: [
            {
              group: ['@sentinel/driver-*'],
              message:
                '@sentinel/ai is driver-agnostic: it must import only the telemetry contract (@sentinel/core), never a driver.',
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
    // NARROW boundary exemption (S4): the page-wrap login flow keeps ONE legitimate
    // Playwright import — `import type { Page }` for its signature (consistent-type-imports
    // + typecheck keep it type-only; no Playwright runtime is pulled in). This single-file
    // exemption replaces the broad S1 `examples/web-erpnext/src/**` block, now that the
    // rest of the rewritten app/flow/component code is fully Playwright-free.
    files: ['examples/web-erpnext/src/flows/auth/log-in.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  eslintConfigPrettier,
];
