import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * One flat config for the whole repo, scoped by glob rather than split per
 * package, so a rule decision is made once and every tradeoff is visible next to
 * the others. `turbo.json` lists this file in the `lint` task's inputs, so
 * editing it invalidates the lint cache without touching build, typecheck or the
 * Chromium test run.
 *
 * Deliberately NOT type-aware. `recommendedTypeChecked` was evaluated and
 * rejected: it predicts zero true positives against this source, which already
 * annotates `unknown` at every untyped boundary and narrows every catch before
 * use; it needs `projectService` plumbing for two files that belong to no
 * tsconfig; and it would roughly triple lint time to duplicate coverage two
 * `tsc --noEmit` tasks already provide.
 */
export default tseslint.config(
  // ESLint 9 ignores node_modules by default.
  { ignores: ['**/dist/**', '**/.turbo/**', '**/coverage/**'] },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          // A leading underscore is this repo's convention for a parameter that
          // exists for arity rather than for use. The load-bearing case is
          // `handleErrors` in server/src/index.ts: Express identifies error
          // middleware by its four-parameter arity, so deleting the unused
          // `_next` would silently turn every error response into Express's
          // default HTML 500 page, with no compile error and no failing test.
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // ---------------------------------------------------------------- client
  {
    files: ['apps/client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      // Named individually rather than spread from the plugin's preset. v7 ships
      // the React Compiler rule set, and pulling that in as a side effect of a
      // caret upgrade would turn lint red for reasons unrelated to this repo.
      // Enable those deliberately, in their own change, or not at all.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
  },

  {
    files: ['apps/client/**/*.tsx'],
    ...jsxA11y.flatConfigs.recommended,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      /**
       * Widened, not disabled.
       *
       * A scrollable region must be keyboard reachable under WCAG 2.1.1, which
       * is axe's own `scrollable-region-focusable` rule, and this app reports
       * that rule to its users. CodeSnippet and MarkdownAnswer both put
       * `tabIndex={0}` on a scrolling `<pre role="group">` for exactly that
       * reason. The plugin's default allow list is `['tabpanel']`, so it reads
       * correct code as an error. Adding `group` keeps a stray tabIndex on a
       * plain `<div>` an error, which is the case the rule is actually for.
       *
       * When the linter and axe disagree about accessibility, axe wins.
       */
      'jsx-a11y/no-noninteractive-tabindex': [
        'error',
        { tags: [], roles: ['tabpanel', 'group'], allowExpressionValues: true },
      ],
    },
  },

  // ---------------------------------------------------------------- server
  {
    files: ['apps/server/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
);

