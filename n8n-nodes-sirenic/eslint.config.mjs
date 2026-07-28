/**
 * Reproduit LOCALEMENT ce que le scanner officiel applique en ligne.
 *
 * Deux jeux de règles, et il faut les DEUX :
 *   - `@n8n/eslint-plugin-community-nodes` (42 règles) — sécurité et packaging ;
 *   - `eslint-plugin-n8n-nodes-base` — conventions d'interface (casse des
 *     actions, ponctuation des descriptions, placeholders).
 *
 * Le second manquait à la première version de ce fichier : le lint local
 * passait au vert pendant que `npx @n8n/scan-community-package` relevait
 * 8 violations sur ces mêmes fichiers. Un outil de vérification ne vaut que par
 * ce qu'il regarde vraiment — contrôler le nombre de fichiers analysés ET les
 * règles chargées, jamais se fier au seul « 0 error ».
 *
 * Le scanner analyse aussi le BUNDLE publié (`dist/`), où viem et le client
 * x402 déclenchent `no-restricted-globals` (setTimeout, globalThis) et deux
 * faux positifs `no-hardcoded-secrets` sur des constantes du SDK
 * (EIP2612_GAS_SPONSORING_KEY). Ces violations appartiennent au code tiers
 * inliné et ne sont pas corrigeables ici. Un node DÉJÀ VÉRIFIÉ
 * (`@alephantai/n8n-nodes-alephant`) échoue sur le même type de règle, ce qui
 * montre que le scan n'est pas éliminatoire — on assume l'écart en le
 * documentant plutôt qu'en le masquant.
 */
import { defineConfig } from 'eslint/config';
import communityNodes from '@n8n/eslint-plugin-community-nodes';
import n8nNodesBase from 'eslint-plugin-n8n-nodes-base';
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
	{
		files: ['nodes/**/*.ts'],
		languageOptions: { parser: tseslint.parser },
		plugins: { 'n8n-nodes-base': n8nNodesBase },
		rules: {
			...n8nNodesBase.configs.nodes.rules,
			// ⚠️ CES DEUX RÈGLES CONTREDISENT `@n8n/community-nodes`, qui exige
			// `NodeConnectionTypes.Main` là où celles-ci réclament le littéral
			// `['main']`. Impossible de satisfaire les deux. Arbitrage : on suit
			// le plugin community-nodes, qui est celui que les guidelines de
			// vérification citent nommément — et le scanner officiel ne relève
			// PAS ces deux-là sur notre paquet, ce qui confirme le choix.
			'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
			'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
		},
	},
	{
		files: ['credentials/**/*.ts'],
		languageOptions: { parser: tseslint.parser },
		plugins: { 'n8n-nodes-base': n8nNodesBase },
		rules: {
			...n8nNodesBase.configs.credentials.rules,
			// Réclame `documentationURL` en camelCase, mais l'interface
			// `ICredentialType` de n8n-workflow déclare `documentationUrl` : la
			// règle est en retard sur le type, et la suivre ne compilerait pas.
			// Non relevée non plus par le scanner officiel.
			'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
		},
	},
]);
