// Flat config for the monorepo root and the plain Node/TypeScript packages (TYPESCRIPT_STANDARD_2026 §5).
import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/coverage/**',
      '**/migrations/**',
      // The two Nuxt apps lint themselves with @nuxt/eslint (their own eslint.config.mjs):
      // that config knows auto-imports and Vue SFCs, which this one does not.
      'apps/site/**',
      'apps/admin/**',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    // The root tsconfig.json includes eslint.config.ts and vitest.config.ts, so no allowDefaultProject is needed.
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'error',
    },
  },
)
