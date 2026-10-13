import js from '@eslint/js';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { frontendPlugin } from './frontend-rules.js';

/** 各运行环境共用类型检查规则；Node globals 不进入浏览器程序。 */
export function createConfig(rootDirectory) {
  return tseslint.config(
    {
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/out/**',
        '**/release/**',
        '**/.cache/**',
        '**/.turbo/**',
        '**/coverage/**',
        '**/playwright-report/**',
        '**/test-results/**',
        '**/output/**',
      ],
    },
    {
      ...js.configs.recommended,
      files: ['**/*.{js,mjs,cjs}'],
      languageOptions: { globals: globals.node },
    },
    {
      files: ['**/*.{ts,tsx,cts,mts}'],
      extends: [tseslint.configs.recommendedTypeChecked],
      languageOptions: {
        parserOptions: {
          project: [
            './tsconfig.json',
            './apps/daemon/tsconfig.json',
            './apps/web/tsconfig.json',
            './apps/web/tsconfig.node.json',
            './apps/desktop/tsconfig.main.json',
            './apps/desktop/tsconfig.preload.json',
            './packages/protocol/tsconfig.json',
          ],
          tsconfigRootDir: rootDirectory,
        },
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': 'error',
        '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
        '@typescript-eslint/explicit-module-boundary-types': 'error',
        '@typescript-eslint/no-non-null-assertion': 'error',
        'no-restricted-syntax': [
          'error',
          {
            selector: 'TSAsExpression > TSAsExpression[typeAnnotation.type="TSUnknownKeyword"]',
            message: '禁止 as unknown as T；补充真实输入校验或准确类型。',
          },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
    {
      files: ['apps/web/src/**/*.{ts,tsx}'],
      languageOptions: { globals: globals.browser },
      plugins: { 'react-hooks': hooks, 'project-react': frontendPlugin },
      rules: {
        'arrow-body-style': ['error', 'always'],
        '@typescript-eslint/explicit-function-return-type': [
          'error',
          { allowTypedFunctionExpressions: true },
        ],
        'project-react/component-declaration': 'error',
        'project-react/zustand-selector': 'error',
        'project-react/transport-owner': 'error',
        'no-nested-ternary': 'error',
        'no-restricted-syntax': [
          'error',
          { selector: 'ExportDefaultDeclaration', message: 'Renderer 使用具名导出。' },
          {
            selector: 'JSXExpressionContainer ConditionalExpression',
            message: 'JSX 条件渲染使用 && 或有类型的映射。',
          },
          {
            selector: 'JSXAttribute[name.name="style"]',
            message: '样式使用 Tailwind 或组件样式文件。',
          },
          {
            selector: 'TSAsExpression > TSAsExpression[typeAnnotation.type="TSUnknownKeyword"]',
            message: '禁止双重 unknown 断言。',
          },
        ],
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'error',
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              'node:*',
              'electron',
              'electron/*',
              '@my-pi-harness/daemon',
              '@my-pi-harness/agent-runtime',
              '@radix-ui/*',
            ],
          },
        ],
      },
    },
    {
      files: ['apps/web/src/components/ui/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              'node:*',
              'electron',
              'electron/*',
              '@my-pi-harness/daemon',
              '@my-pi-harness/agent-runtime',
            ],
          },
        ],
      },
    },
    {
      files: ['packages/protocol/src/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          { patterns: ['node:*', 'electron', 'electron/*', '@earendil-works/*'] },
        ],
      },
    },
  );
}
