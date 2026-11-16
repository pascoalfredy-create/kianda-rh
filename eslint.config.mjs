// Análise estática do código TypeScript (com tipos). Corre no CI: `pnpm lint`.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import sonarjs from 'eslint-plugin-sonarjs';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/.next/**', '**/.open-next/**', '**/coverage/**', '**/public/**',
      '**/*generated*', '**/*.js', '**/*.mjs', '**/*.cjs', 'apps/api/src/lib/financial-fonts.ts', 'apps/e2e/**', '**/next-env.d.ts',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { 'react-hooks': reactHooks, sonarjs },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // Manutenibilidade: nenhuma função pode ultrapassar a complexidade cognitiva 50 (alvo habitual: até 25).
      'sonarjs/cognitive-complexity': ['error', 50],
      'react-hooks/exhaustive-deps': 'warn',
      // Promessas: nenhuma pode ficar sem tratamento; handlers assíncronos em atributos JSX são aceites.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', destructuredArrayIgnorePattern: '^_' }],
      // Dados externos (JSON, formulários) são validados com zod na API; no cliente aceitam-se leituras não tipadas.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      // Asserções redundantes são inofensivas e o autofix pode remover algumas que ainda são necessárias entre pacotes.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
  {
    // Testes: duplos e simulações podem ser menos tipados.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
