/**
 * n8n's official community-node ruleset (42 rules). Verification requires,
 * verbatim: "Make sure the linter passes."
 *
 * The shipped `recommended` config declares no `files`, and ESLint 9 only
 * picks up `.js` by default — so the glob is set here explicitly. Without it
 * the lint reports success having read nothing at all.
 */
import { defineConfig } from 'eslint/config';
import communityNodes from '@n8n/eslint-plugin-community-nodes';
import tseslint from 'typescript-eslint';

export default defineConfig([
	{
		ignores: ['dist/**', 'node_modules/**', 'build.mjs', 'smoke.mjs', 'tests/**'],
	},
	{
		files: ['nodes/**/*.ts', 'credentials/**/*.ts'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { project: './tsconfig.json' },
		},
		...communityNodes.configs.recommended,
	},
]);
