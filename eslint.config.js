import js from '@eslint/js';
import globals from 'globals';
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/.angular/**',
      '**/node_modules/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/api/**/*.ts', 'packages/shared/**/*.ts', 'apps/e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Tests assert on rows they just inserted; `row!` is clearer there than repeated guards.
    files: [
      'apps/api/test/**/*.ts',
      'packages/shared/test/**/*.ts',
      'apps/web/src/**/*.spec.ts',
      'apps/e2e/**/*.ts',
    ],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // Business logic must never import a concrete payment provider; only the factory may.
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/modules/payments/factory.ts', 'apps/api/src/modules/payments/*/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/payments/mock/**', '**/payments/razorpay/**'],
              message:
                'Depend on PaymentProvider from payments/provider.ts, not a concrete provider.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.ts'],
    extends: [...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    files: ['apps/web/src/**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
  },
);
