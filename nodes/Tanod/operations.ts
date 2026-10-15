/** Route table for the Tanod node. Prices and request fields follow https://tanod.dev/openapi.json. */
export interface OpDef {
	resource: 'document' | 'web' | 'audio' | 'text' | 'utility';
	value: string;
	name: string;
	description: string;
	path: string;
	price: string; // USD, for display
	free: boolean; // has a free daily allowance (X-Tanod-Free: 1)
	/** how a file/URL input is accepted */
	input: 'file-or-url' | 'url' | 'none';
	/** JSON field name carrying the base64 file, when input is file-or-url */
	fileField?: string;
	/** the reply carries a base64 `file` that becomes n8n binary data */
	returnsFile?: boolean;
}

export const OPS: OpDef[] = [
	{
		resource: 'document', value: 'toMarkdown', name: 'Document to Markdown',
		description: 'PDF, DOCX, XLSX, PPTX, EPUB, HTML or CSV to Markdown (USD 0.005)',
		path: '/v1/docs/to-markdown', price: '0.005', free: false, input: 'file-or-url', fileField: 'file_base64',
	},
	{
		resource: 'document', value: 'pdfTables', name: 'PDF Tables',
		description: 'Extract tables from a text PDF as JSON, CSV or XLSX (USD 0.01)',
		path: '/v1/pdf/tables', price: '0.01', free: false, input: 'file-or-url', fileField: 'file_base64',
	},
	{
		resource: 'document', value: 'ocrImage', name: 'OCR Image',
		description: 'Extract text from an image URL with Tesseract (USD 0.0025)',
		path: '/v1/ocr', price: '0.0025', free: true, input: 'url',
	},
	{
		resource: 'document', value: 'pdfToWord', name: 'PDF to Word',
		description: 'Convert a PDF to a .docx file (USD 0.01)',
		path: '/v1/pdf/to-docx', price: '0.01', free: false, input: 'file-or-url', fileField: 'pdf_base64', returnsFile: true,
	},
	{
		resource: 'document', value: 'officeToPdf', name: 'Office to PDF',
		description: 'Convert DOCX, XLSX, PPTX, ODT, RTF or text to PDF (USD 0.01)',
		path: '/v1/docs/to-pdf', price: '0.01', free: false, input: 'file-or-url', fileField: 'file_base64', returnsFile: true,
	},
	{
		resource: 'web', value: 'pageToMarkdown', name: 'Page to Markdown',
		description: 'Fetch a web page as clean Markdown (USD 0.002, 0.01 with JavaScript)',
		path: '/v1/render', price: '0.002', free: true, input: 'url',
	},
	{
		resource: 'web', value: 'screenshot', name: 'Website Screenshot',
		description: 'Capture a web page as a PNG or JPEG image (USD 0.005)',
		path: '/v1/web/screenshot', price: '0.005', free: false, input: 'url', returnsFile: true,
	},
	{
		resource: 'audio', value: 'speechToText', name: 'Speech to Text',
		description: 'Transcribe an audio file, with SRT and WebVTT subtitles (USD 0.01)',
		path: '/v1/audio/transcribe', price: '0.01', free: false, input: 'file-or-url', fileField: 'file_base64',
	},
	{
		resource: 'text', value: 'translate', name: 'Translate',
		description: 'Translate text between English and 14 languages (USD 0.003)',
		path: '/v1/text/translate', price: '0.003', free: true, input: 'none',
	},
	{
		resource: 'utility', value: 'verifyEmail', name: 'Verify Email Address',
		description: 'Check an email address by syntax and DNS (MX), no mailbox probe (USD 0.001)',
		path: '/v1/email/verify', price: '0.001', free: true, input: 'none',
	},
];
