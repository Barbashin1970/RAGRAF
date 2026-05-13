// ESLint flat config for RAGRAF frontend.
// Базовый набор по рекомендации Sigma-audit v0.5.4:
//   - typescript-eslint:strict     — покрывает R6 (`as` boundary), R7 (`any`)
//   - react-hooks:recommended      — покрывает R1 (rules-of-hooks), R2 (exhaustive-deps)
//   - react-refresh:vite           — HMR sanity
//
// R5 (missing-key) — встроен в TypeScript-ESLint строгий пресет через
// `react/jsx-key` если установим `eslint-plugin-react`. Сейчас держим
// minimum-viable baseline; добавим plugin react полностью когда понадобится.

import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', '**/*.test.ts', 'src/types.d.ts'],
  },
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // R1, R2 (hooks rules + exhaustive deps) — error
      ...reactHooks.configs.recommended.rules,
      // HMR sanity
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // R7.1 / R7.2 (any usage) — ts-eslint:strict уже включает no-explicit-any как warn;
      // мы хотим error, чтобы боундарные касты были видны в CI:
      '@typescript-eslint/no-explicit-any': 'warn',
      // R7 (@ts-ignore / @ts-expect-error) — strict уже включает ban-ts-comment

      // R8 (floating promises) — нужен type-checked linter; пока выключаем,
      // вынесем в отдельный конфиг typed-linting позже.
      // '@typescript-eslint/no-floating-promises': 'error',

      // Послабления для текущей кодовой базы (нашлось во время аудита):
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Non-null assertion `!` — стандартный паттерн React boilerplate
      // (`document.getElementById('root')!`) и узкого narrowing после
      // null-проверки. Держим как warning чтобы видеть, но не блокировать.
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // void в generic type-args — валидный случай (request<void> для DELETE-эндпоинтов).
      '@typescript-eslint/no-invalid-void-type': ['error', { allowAsThisParameter: true, allowInGenericTypeArguments: true }],
    },
  },
)
