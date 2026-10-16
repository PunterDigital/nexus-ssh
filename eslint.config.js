import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        document: 'readonly',
        window: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        __dirname: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // TypeScript already checks for undefined identifiers (typescript-eslint recommends this off).
      'no-undef': 'off',
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'error',
      'react/react-in-jsx-scope': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    // Electron main process: native CommonJS modules (sqlcipher, libsodium) are loaded with require().
    files: ['src/main/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Design-system primitives (and, as screens are redesigned, new UI): tokens only.
    // See docs/design-system.md → "Rules".
    files: [
      'src/renderer/components/ui/**/*.{ts,tsx}',
      'src/renderer/components/shell/**/*.{ts,tsx}',
      // #2366 part 1; the rest of components/vault joins in part 2
      'src/renderer/components/vault/LockScreen.tsx',
      'src/renderer/components/vault/LockLayout.tsx',
      'src/renderer/components/vault/CreateVaultDialog.tsx',
      'src/renderer/components/vault/ConnectionsView.tsx',
      'src/renderer/components/vault/ContextMenu.tsx',
      'src/renderer/components/vault/SyncStatusBadge.tsx',
      'src/renderer/components/vault/SwitchVaultHost.tsx',
      'src/renderer/components/vault/HostForm.tsx',
      'src/renderer/components/vault/GroupForm.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/], TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]',
          message: 'No raw hex colours: use a colour token (bg-surface-raised, text-fg-muted, …).',
        },
        {
          selector: 'Literal[value=/(^|\\s)[\\w:-]+-\\[[^\\]]+\\]/], TemplateElement[value.raw=/(^|\\s)[\\w:-]+-\\[[^\\]]+\\]/]',
          message: 'No Tailwind arbitrary values (p-[7px], text-[var(--x)]): use the scale or a token, e.g. z-(--z-dialog).',
        },
        {
          selector: "JSXAttribute[name.name='style']",
          message: 'No inline styles: use token utilities.',
        },
      ],
    },
  },
  {
    ignores: ['dist/', 'dist-release/', 'node_modules/', '*.config.*'],
  },
];
