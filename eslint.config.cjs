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
                'Playwright is confined to @sentinele2e/driver-playwright and test-runner dirs.',
            },
            {
              name: 'playwright',
              message:
                'Playwright is confined to @sentinele2e/driver-playwright and test-runner dirs.',
            },
            {
              name: 'selenium-webdriver',
              message:
                'Selenium is confined to @sentinele2e/driver-selenium and test-runner dirs.',
            },
          ],
          patterns: [
            {
              group: ['selenium-webdriver', 'selenium-webdriver/*'],
              message:
                'Selenium is confined to @sentinele2e/driver-selenium and test-runner dirs.',
            },
          ],
        },
      ],
    },
  },
  {
    // DRIVER-AGNOSTIC boundary (slice B): @sentinele2e/ai analyzer source must
    // import NO driver — neither Playwright nor any @sentinele2e/driver-* package.
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
                'Playwright is confined to @sentinele2e/driver-playwright and test-runner dirs.',
            },
            {
              name: 'playwright',
              message:
                'Playwright is confined to @sentinele2e/driver-playwright and test-runner dirs.',
            },
            {
              name: 'selenium-webdriver',
              message:
                'Selenium is confined to @sentinele2e/driver-selenium and test-runner dirs.',
            },
          ],
          patterns: [
            {
              group: ['@sentinele2e/driver-*'],
              message:
                '@sentinele2e/ai is driver-agnostic: it must import only the telemetry contract (@sentinele2e/core), never a driver.',
            },
          ],
        },
      ],
    },
  },
  {
    // DRIVER-AGNOSTIC boundary (slice E): @sentinele2e/cli source must import NO
    // driver — neither Playwright/Selenium nor any @sentinele2e/driver-* package.
    // The `run` command SHELLS OUT to `npx playwright test`; the CLI never
    // imports the runner. Tests under packages/cli/tests/** keep the exemption.
    files: ['packages/cli/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              message:
                'Playwright is confined to @sentinele2e/driver-playwright and test-runner dirs.',
            },
            {
              name: 'playwright',
              message:
                'Playwright is confined to @sentinele2e/driver-playwright and test-runner dirs.',
            },
            {
              name: 'selenium-webdriver',
              message:
                'Selenium is confined to @sentinele2e/driver-selenium and test-runner dirs.',
            },
          ],
          patterns: [
            {
              group: ['selenium-webdriver', 'selenium-webdriver/*'],
              message:
                'Selenium is confined to @sentinele2e/driver-selenium and test-runner dirs.',
            },
            {
              group: ['@sentinele2e/driver-*'],
              message:
                '@sentinele2e/cli is driver-agnostic: it depends only on @sentinele2e/ai + core/contracts and shells out to the project runner, never importing a driver.',
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
      'packages/driver-selenium/**/*.ts',
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
