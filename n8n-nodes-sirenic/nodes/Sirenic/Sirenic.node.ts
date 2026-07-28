import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { SirenicPayer, type PaymentSettings } from './x402';

/**
 * Sirenic — official French and European company data, paid per call.
 *
 * Deliberately NOT a wrapper around all 41 routes: seven operations that make
 * sense inside a no-code workflow. Anything more specialised is better reached
 * through the MCP server or the REST API directly.
 */
export class Sirenic implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sirenic',
		name: 'sirenic',
		icon: { light: 'file:sirenic.light.svg', dark: 'file:sirenic.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Official French and European company data, paid per call — no API key',
		defaults: { name: 'Sirenic' },
		// An AI agent asked to vet a supplier should be able to reach this
		// directly; the spending caps in the credential are what make that safe.
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'sirenicApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'frenchCompany',
				options: [
					{ name: 'French Company', value: 'frenchCompany' },
					{ name: 'European Company', value: 'europeanCompany' },
					{ name: 'Verification', value: 'verification' },
					{ name: 'Monitoring', value: 'monitoring' },
				],
			},

			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'search',
				displayOptions: { show: { resource: ['frenchCompany'] } },
				options: [
					{
						name: 'Search',
						value: 'search',
						action: 'Search French companies by name',
						description:
							'Find a French company by name when you do not have its SIREN. Returns the top matches with a confidence score. ($0.001)',
					},
					{
						name: 'Get Profile',
						value: 'getProfile',
						action: 'Get a French company profile',
						description:
							'Official profile by SIREN: legal name, form, head office, activity code, workforce, officers, VAT number. ($0.005)',
					},
					{
						name: 'Get KYB File',
						value: 'getKyb',
						action: 'Get a full KYB file',
						description:
							'Everything needed to onboard a supplier in one call: identity, officers, insolvency alerts, filed financials, sanctions screening. ($0.15)',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'get',
				displayOptions: { show: { resource: ['europeanCompany'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						action: 'Get a European company',
						description:
							'Company data from an official register in 11 European countries, under one schema. ($0.01)',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'screenSanctions',
				displayOptions: { show: { resource: ['verification'] } },
				options: [
					{
						name: 'Screen Sanctions',
						value: 'screenSanctions',
						action: 'Screen a name against sanctions lists',
						description:
							'Screen a person or company name against 6 official lists (UN, EU, OFAC, UK, French freezes, Swiss SECO). Returns scored matches, never a bare yes or no. ($0.02)',
					},
					{
						name: 'Verify VAT Number',
						value: 'verifyVat',
						action: 'Verify an EU VAT number',
						description: 'Check an intra-EU VAT number against VIES. ($0.003)',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'watch',
				displayOptions: { show: { resource: ['monitoring'] } },
				options: [
					{
						name: 'Watch Companies',
						value: 'watch',
						action: 'Watch companies for changes',
						description:
							'Monitor 1 to 100 companies and get notified when something changes: officers, insolvency, deregistration. Point the webhook at an n8n Webhook node to trigger a workflow. ($0.05)',
					},
				],
			},

			{
				displayName: 'Company Name',
				name: 'query',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['frenchCompany'], operation: ['search'] } },
				description: 'Company name, or a 9-digit SIREN',
			},
			{
				displayName: 'SIREN',
				name: 'siren',
				type: 'string',
				default: '',
				required: true,
				placeholder: '552032534',
				displayOptions: { show: { resource: ['frenchCompany'], operation: ['getProfile', 'getKyb'] } },
				description: '9-digit French company identifier',
			},
			{
				displayName: 'Country',
				name: 'country',
				type: 'options',
				default: 'BE',
				displayOptions: { show: { resource: ['europeanCompany'] } },
				options: [
					{ name: 'Belgium', value: 'BE' },
					{ name: 'Czechia', value: 'CZ' },
					{ name: 'Denmark', value: 'DK' },
					{ name: 'Estonia', value: 'EE' },
					{ name: 'Finland', value: 'FI' },
					{ name: 'Latvia', value: 'LV' },
					{ name: 'Norway', value: 'NO' },
					{ name: 'Poland', value: 'PL' },
					{ name: 'Slovakia', value: 'SK' },
					{ name: 'Switzerland', value: 'CH' },
					{ name: 'United Kingdom', value: 'GB' },
				],
				description: 'Register to query',
			},
			{
				displayName: 'Company Identifier',
				name: 'companyId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['europeanCompany'] } },
				description: 'National registration number, as used by that country register',
			},
			{
				displayName: 'Name to Screen',
				name: 'name',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['verification'], operation: ['screenSanctions'] } },
				description: 'Person or company name to screen',
			},
			{
				displayName: 'VAT Number',
				name: 'vatNumber',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'FR12345678901',
				displayOptions: { show: { resource: ['verification'], operation: ['verifyVat'] } },
				description: 'Intra-EU VAT number, country prefix included',
			},
			{
				displayName: 'Targets',
				name: 'targets',
				type: 'string',
				default: '',
				required: true,
				placeholder: '552032534,542065479',
				displayOptions: { show: { resource: ['monitoring'] } },
				description:
					'1 to 100 comma-separated entries: 9-digit SIRENs, or "dirigeant:Name" to follow a person mandates',
			},
			{
				displayName: 'Webhook URL',
				name: 'webhook',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['monitoring'] } },
				description:
					'Public HTTPS URL notified when something changes. Paste the Production URL of an n8n Webhook node to trigger a workflow on every change.',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['monitoring'] } },
				description: 'Optional address for digest emails',
			},

			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Dry Run',
						name: 'dryRun',
						type: 'boolean',
						default: false,
						description:
							'Whether to check the price and stop without paying. Returns what the call would cost.',
					},
					{
						displayName: 'Timeout (Ms)',
						name: 'timeout',
						type: 'number',
						default: 120000,
						description: 'How long to wait for a paid response',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const credentials = await this.getCredentials('sirenicApi');

		const settings: PaymentSettings = {
			privateKey: String(credentials.privateKey ?? ''),
			baseUrl: String(credentials.baseUrl ?? 'https://api.sirenic.eu'),
			payTo: String(credentials.payTo ?? ''),
			maxPerCall: Number(credentials.maxAmountPerCall ?? 0),
			maxPerExecution: Number(credentials.maxAmountPerExecution ?? 0),
		};
		if (!settings.privateKey.startsWith('0x') || settings.privateKey.length !== 66) {
			throw new NodeOperationError(
				this.getNode(),
				'The wallet private key must be a 0x-prefixed 32-byte hex string.',
			);
		}
		if (!(settings.maxPerCall > 0) || !(settings.maxPerExecution > 0)) {
			throw new NodeOperationError(
				this.getNode(),
				'Both spending caps must be greater than zero. They are what keeps a runaway workflow from draining the wallet.',
			);
		}

		// One payer per execution: the per-execution cap spans every item.
		const payer = new SirenicPayer(settings);
		const output: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const options = this.getNodeParameter('options', i, {}) as {
					dryRun?: boolean;
					timeout?: number;
				};
				const path = buildPath(this, resource, operation, i);

				const result = await payer.call(path, options.timeout ?? 120_000, options.dryRun === true);

				output.push({
					json: {
						...(typeof result.body === 'object' && result.body !== null && !Array.isArray(result.body)
							? (result.body as Record<string, unknown>)
							: { result: result.body }),
						_sirenic: {
							resource,
							operation,
							status: result.status,
							paid_usd: result.paid,
							execution_total_usd: payer.totalPaid,
						},
					},
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					output.push({
						json: { error: error instanceof Error ? error.message : String(error) },
						pairedItem: { item: i },
					});
					continue;
				}
				// Never re-throw a raw error: a refused payment must reach the user
				// as an n8n error carrying the node and the item, not an opaque
				// stack trace. Wrapping unconditionally also satisfies n8n's
				// `require-node-api-error` rule, which forbids bare re-throws.
				throw new NodeOperationError(
					this.getNode(),
					error instanceof Error ? error.message : String(error),
					{ itemIndex: i },
				);
			}
		}

		return [output];
	}
}

/** Builds the API path for one item. Kept separate so it stays easy to test. */
function buildPath(
	ctx: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): string {
	const p = (name: string) => String(ctx.getNodeParameter(name, i) ?? '').trim();
	const enc = encodeURIComponent;

	if (resource === 'frenchCompany') {
		if (operation === 'search') return `/v1/recherche?q=${enc(p('query'))}`;
		if (operation === 'getProfile') return `/v1/entreprise/${enc(p('siren'))}`;
		if (operation === 'getKyb') return `/v1/kyb/${enc(p('siren'))}`;
	}
	if (resource === 'europeanCompany' && operation === 'get') {
		return `/v1/eu/entreprise/${enc(p('country'))}/${enc(p('companyId'))}`;
	}
	if (resource === 'verification') {
		if (operation === 'screenSanctions') return `/v1/sanctions/check?name=${enc(p('name'))}`;
		if (operation === 'verifyVat') return `/v1/tva/verifier/${enc(p('vatNumber'))}`;
	}
	if (resource === 'monitoring' && operation === 'watch') {
		const query = new URLSearchParams({ cibles: p('targets') });
		const webhook = p('webhook');
		const email = p('email');
		if (webhook) query.set('webhook', webhook);
		if (email) query.set('email', email);
		return `/v1/surveillance/creer?${query.toString()}`;
	}
	throw new NodeOperationError(ctx.getNode(), `Unknown operation: ${resource}.${operation}`);
}
