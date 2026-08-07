import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 빌드 도구 스크립트는 Node에서 직접 실행된다
    files: ['tools/**/*.{js,mjs}'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
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
