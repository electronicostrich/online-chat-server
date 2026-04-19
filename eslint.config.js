import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import playwrightPlugin from 'eslint-plugin-playwright';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/drizzle/**',
      'apps/web/dist/**',
      'scripts/claude-hooks/**',
    ],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      // Hard bans — see docs/ai-development-guardrails.md §5.1
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': false,
          'ts-nocheck': false,
          minimumDescriptionLength: 10,
        },
      ],
      'no-console': 'error',
      // TODO is intentionally excluded here per docs/stage-0-bootstrap.md §7 (decision):
      // `TODO(#N): ...` issue-link enforcement lives in scripts/check-suppressions.ts
      // (tracked by issue #6).
      'no-warning-comments': ['error', { terms: ['FIXME', 'XXX'], location: 'anywhere' }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['zod', 'yup', 'joi', 'ajv'],
              message: 'TypeBox is the only schema library (ADR-010).',
            },
            {
              group: ['apps/api/*', '../../../apps/api/**'],
              message: 'Frontend cannot import backend internals.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'warn',
    },
  },
  {
    files: ['apps/api/src/modules/*/service.ts', 'apps/api/src/modules/*/repository.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'fastify', message: 'Business logic must not import from fastify.' }],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/modules/*/routes.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'drizzle-orm', message: 'Routes must call repositories, not Drizzle directly.' },
          ],
        },
      ],
    },
  },
  {
    files: ['e2e/**/*.spec.ts'],
    ...playwrightPlugin.configs['flat/recommended'],
    rules: {
      'playwright/no-focused-test': 'error',
      'playwright/no-skipped-test': 'error',
      'playwright/expect-expect': 'error',
    },
  },
  {
    files: ['apps/api/test/**/*.test.ts', 'apps/web/test/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      'no-console': 'off',
    },
  },
  {
    // Root-level config files that don't need type-aware lint. Applied last so
    // it overrides the strictTypeChecked preset's parser+rules for these paths.
    files: [
      'eslint.config.js',
      'prettier.config.js',
      'apps/api/drizzle.config.ts',
      'apps/web/vite.config.ts',
    ],
    ...tseslint.configs.disableTypeChecked,
  },
);
