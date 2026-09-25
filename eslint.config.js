import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', 'packages/db/src/schema.ts', 'test-results/**', 'referencias/**', 'exemplos/**', '**/next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // Dinheiro nunca em float: proíbe parseFloat/toFixed fora de formatação conhecida.
      'no-restricted-properties': ['error', { object: 'Number', property: 'parseFloat', message: 'Use centavos inteiros (parseBRL/toCents).' }],
      'no-restricted-globals': ['error', { name: 'parseFloat', message: 'Use centavos inteiros (parseBRL/toCents).' }],
    },
  },
);
