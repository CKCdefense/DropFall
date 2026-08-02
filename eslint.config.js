import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/shared/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['phaser', 'colyseus', '@colyseus/core', '@colyseus/schema', 'express', 'ws'],
          patterns: ['node:*'],
        },
      ],
    },
  },
);
