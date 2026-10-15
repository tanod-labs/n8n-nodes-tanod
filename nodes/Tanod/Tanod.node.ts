import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { OPS, type OpDef } from './operations';
import { tanodRequest, TanodPaymentError } from './transport';

const RESOURCES = [
	{ name: 'Document', value: 'document' },
	{ name: 'Web', value: 'web' },
	{ name: 'Audio', value: 'audio' },
	{ name: 'Text', value: 'text' },
	{ name: 'Utility', value: 'utility' },
];

const show = (resource: string, ...ops: string[]) => ({
	show: { resource: [resource], ...(ops.length ? { operation: ops } : {}) },
});

const opProps: INodeProperties[] = RESOURCES.map((r) => ({
	displayName: 'Operation',
	name: 'operation',
	type: 'options' as const,
	noDataExpression: true,
	displayOptions: { show: { resource: [r.value] } },
	options: OPS.filter((o) => o.resource === r.value).map((o) => ({
		name: o.name,
		value: o.value,
		description: o.description,
		action: o.name,
	})),
	default: OPS.find((o) => o.resource === r.value)!.value,
}));

const fileOps = OPS.filter((o) => o.input === 'file-or-url').map((o) => o.value);
const urlOps = OPS.filter((o) => o.input === 'url').map((o) => o.value);

export class Tanod implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Tanod',
		name: 'tanod',
		icon: 'file:tanod.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Pay-per-call document, web, audio, text and email tools. Free daily allowance; optional x402 wallet for more.',
		defaults: { name: 'Tanod' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'tanodX402Api', required: false }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: RESOURCES,
				default: 'document',
			},
			...opProps,

			// ---- file or URL input
			{
				displayName: 'Input Source',
				name: 'inputSource',
				type: 'options',
				displayOptions: { show: { operation: fileOps } },
				options: [
					{ name: 'Binary Data', value: 'binary' },
					{ name: 'URL', value: 'url' },
				],
				default: 'binary',
				description: 'Where the file comes from',
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				displayOptions: { show: { operation: fileOps, inputSource: ['binary'] } },
				description: 'Name of the binary property that holds the file',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/file',
				displayOptions: { show: { operation: fileOps, inputSource: ['url'] } },
				description: 'Public http(s) URL',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				placeholder: 'https://example.com',
				displayOptions: { show: { operation: urlOps } },
				description: 'Public http(s) URL',
			},

			// ---- operation specific options
			{
				displayName: 'Pages',
				name: 'pages',
				type: 'string',
				default: '',
				placeholder: '1-5,9',
				displayOptions: show('document', 'pdfTables', 'pdfToWord'),
				description: 'Pages to process (N, N-M, N-, -M, last; comma separated). Empty means all.',
			},
			{
				displayName: 'Output Format',
				name: 'tablesFormat',
				type: 'options',
				options: [
					{ name: 'JSON', value: 'json' },
					{ name: 'CSV (Binary)', value: 'csv' },
					{ name: 'XLSX (Binary)', value: 'xlsx' },
				],
				default: 'json',
				displayOptions: show('document', 'pdfTables'),
			},
			{
				displayName: 'Language',
				name: 'ocrLang',
				type: 'string',
				default: 'eng',
				displayOptions: show('document', 'ocrImage'),
				description: 'Tesseract language code (only eng is installed)',
			},
			{
				displayName: 'Run JavaScript',
				name: 'js',
				type: 'boolean',
				default: false,
				displayOptions: show('web', 'pageToMarkdown'),
				description:
					'Whether to render the page in a headless browser first. Costs USD 0.01 and has no free allowance.',
			},
			{
				displayName: 'Image Format',
				name: 'shotFormat',
				type: 'options',
				options: [
					{ name: 'PNG', value: 'png' },
					{ name: 'JPEG', value: 'jpeg' },
				],
				default: 'png',
				displayOptions: show('web', 'screenshot'),
			},
			{
				displayName: 'Width',
				name: 'width',
				type: 'number',
				typeOptions: { minValue: 320, maxValue: 1920 },
				default: 1280,
				displayOptions: show('web', 'screenshot'),
			},
			{
				displayName: 'Height',
				name: 'height',
				type: 'number',
				typeOptions: { minValue: 200, maxValue: 1600 },
				default: 800,
				displayOptions: show('web', 'screenshot'),
			},
			{
				displayName: 'Full Page',
				name: 'fullPage',
				type: 'boolean',
				default: false,
				displayOptions: show('web', 'screenshot'),
			},
			{
				displayName: 'Spoken Language',
				name: 'language',
				type: 'string',
				default: '',
				placeholder: 'en',
				displayOptions: show('audio', 'speechToText'),
				description: 'ISO 639-1 code. Empty means detect automatically.',
			},
			{
				displayName: 'Translate to English',
				name: 'translateToEnglish',
				type: 'boolean',
				default: false,
				displayOptions: show('audio', 'speechToText'),
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				displayOptions: show('text', 'translate'),
				description: 'Text to translate (at most 5,000 characters)',
			},
			{
				displayName: 'Target Language',
				name: 'target',
				type: 'string',
				default: 'es',
				required: true,
				displayOptions: show('text', 'translate'),
				description: 'en, es, fr, de, pt, it, nl, ru, zh, ja, ko, ar, hi, id or tl',
			},
			{
				displayName: 'Source Language',
				name: 'source',
				type: 'string',
				default: '',
				displayOptions: show('text', 'translate'),
				description: 'Empty means detect automatically',
			},
			{
				displayName: 'Email Address',
				name: 'email',
				type: 'string',
				placeholder: 'name@example.com',
				default: '',
				required: true,
				displayOptions: show('utility', 'verifyEmail'),
			},

			// ---- payment
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Max Price per Call (USD)',
						name: 'maxPriceUsd',
						type: 'number',
						typeOptions: { numberPrecision: 4, minValue: 0 },
						default: 0.05,
						description:
							'Refuse to sign an x402 payment above this price. Only used when a Tanod x402 wallet credential is set.',
					},
					{
						displayName: 'Use Free Allowance First',
						name: 'useFree',
						type: 'boolean',
						default: true,
						description:
							'Whether to send X-Tanod-Free: 1 on routes that have a free daily allowance (5 calls per IP per UTC day)',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		let privateKey: string | undefined;
		try {
			const cred = await this.getCredentials('tanodX402Api');
			privateKey = (cred?.privateKey as string) || undefined;
		} catch {
			privateKey = undefined; // credential is optional
		}

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const def = OPS.find((o) => o.value === operation) as OpDef;
				const opts = this.getNodeParameter('options', i, {}) as IDataObject;
				const body = await buildBody(this, i, def);
				const reply = await tanodRequest({
					path: def.path,
					body,
					price: def.price,
					useFree: def.free && opts.useFree !== false,
					privateKey,
					maxPriceUsd: (opts.maxPriceUsd as number | undefined) ?? 0.05,
					dynamicPrice: operation === 'pageToMarkdown' && body.js === true,
				});

				const json = reply as IDataObject;
				const binary: INodeExecutionData['binary'] = {};
				let n = 0;
				const take = async (f: IDataObject) => {
					if (typeof f.data_base64 !== 'string') return;
					const buf = Buffer.from(f.data_base64, 'base64');
					const key = n === 0 ? 'data' : `data${n + 1}`;
					binary[key] = await this.helpers.prepareBinaryData(
						buf,
						(f.name as string) || undefined,
						(f.content_type as string) || undefined,
					);
					n++;
					delete f.data_base64;
				};
				if (json.file && typeof json.file === 'object') await take(json.file as IDataObject);
				if (Array.isArray(json.files)) for (const f of json.files as IDataObject[]) await take(f);

				out.push({
					json,
					...(n ? { binary } : {}),
					pairedItem: { item: i },
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (this.continueOnFail()) {
					out.push({ json: { error: message }, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof TanodPaymentError || error instanceof Error) {
					throw new NodeOperationError(this.getNode(), message, { itemIndex: i });
				}
				throw error;
			}
		}
		return [out];
	}
}

async function buildBody(ctx: IExecuteFunctions, i: number, def: OpDef): Promise<IDataObject> {
	const body: IDataObject = {};
	const p = (name: string, fallback?: unknown) => ctx.getNodeParameter(name, i, fallback);

	if (def.input === 'file-or-url') {
		const source = p('inputSource', 'binary') as string;
		if (source === 'binary') {
			const prop = p('binaryPropertyName', 'data') as string;
			const meta = ctx.helpers.assertBinaryData(i, prop);
			const buf = await ctx.helpers.getBinaryDataBuffer(i, prop);
			body[def.fileField as string] = buf.toString('base64');
			if (meta.fileName && def.value !== 'pdfTables' && def.value !== 'speechToText' && def.value !== 'pdfToWord') {
				body.filename = meta.fileName;
			}
		} else {
			body.url = p('url') as string;
		}
	} else if (def.input === 'url') {
		body.url = p('url') as string;
	}

	switch (def.value) {
		case 'pdfTables': {
			const pages = p('pages', '') as string;
			if (pages) body.pages = pages;
			body.format = p('tablesFormat', 'json');
			break;
		}
		case 'pdfToWord': {
			const pages = p('pages', '') as string;
			if (pages) body.pages = pages;
			break;
		}
		case 'ocrImage':
			body.lang = p('ocrLang', 'eng');
			break;
		case 'pageToMarkdown':
			body.format = 'markdown';
			body.js = p('js', false);
			break;
		case 'screenshot':
			body.format = p('shotFormat', 'png');
			body.width = p('width', 1280);
			body.height = p('height', 800);
			body.full_page = p('fullPage', false);
			break;
		case 'speechToText': {
			const lang = p('language', '') as string;
			if (lang) body.language = lang;
			if (p('translateToEnglish', false)) body.translate_to_english = true;
			break;
		}
		case 'translate': {
			body.text = p('text');
			body.target = p('target');
			const src = p('source', '') as string;
			if (src) body.source = src;
			break;
		}
		case 'verifyEmail':
			body.email = p('email');
			break;
	}
	if (def.returnsFile || def.value === 'pdfTables') body.output = 'base64';
	return body;
}
