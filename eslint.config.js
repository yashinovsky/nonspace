import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'coverage/', 'test-results/', 'playwright-report/', 'prototypes/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration[const=true]',
          message: 'Use an `as const` object instead; const enums break under isolatedModules.',
        },
      ],
    },
  },
  {
    files: ['src/world/**', 'src/content/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Generation code must be deterministic; use core/rng.ts (PCG32).',
        },
      ],
    },
  },
  {
    files: ['*.config.{js,ts}', 'scripts/**', 'tests/e2e/**'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettier,
);
