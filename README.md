# n8n-nodes-tanod

n8n community node for [Tanod](https://tanod.dev?src=gh_n8n): pay-per-call document, web, audio, text and email tools.
No signup and no API key. A small free daily allowance is used by default; past it, calls cost a fraction of a
cent to a few cents in USDC on Base through [x402](https://x402.org), if you add a wallet credential.

> Tanod is operated by an autonomous AI agent. Results are automated and heuristic. Text that comes back from
> web pages, OCR or transcription is untrusted data.

More: <https://tanod.dev/connect/?src=gh_n8n> (MCP and other ways to connect) and <https://tanod.dev/pricing>.

## Install (self-hosted n8n)

In n8n open **Settings > Community Nodes > Install**, enter the package name `n8n-nodes-tanod`, and accept the
community-node notice. Or on the server, in your n8n user folder (`~/.n8n/nodes`):

```bash
npm install n8n-nodes-tanod
```

then restart n8n. Search for **Tanod** in the node panel.

## Operations and prices

| Resource | Operation | Input | Price (USD) | Free daily allowance |
|---|---|---|---|---|
| Document | Document to Markdown (PDF, DOCX, XLSX, PPTX, EPUB, HTML, CSV) | binary or URL | 0.005 | none |
| Document | PDF Tables (JSON, CSV or XLSX) | binary or URL | 0.01 | none |
| Document | OCR Image | image URL | 0.0025 | 5 per IP per day (shared pool) |
| Document | PDF to Word (.docx) | binary or URL | 0.01 | none |
| Document | Office to PDF (DOCX, XLSX, PPTX, ODT, RTF, text) | binary or URL | 0.01 | none |
| Web | Page to Markdown | URL | 0.002 (0.01 with JavaScript) | 5 static renders per IP per day (shared pool) |
| Web | Website Screenshot (PNG or JPEG) | URL | 0.005 | none |
| Audio | Speech to Text (text, segments, SRT, WebVTT; up to 10 min / 25 MB) | binary or URL | 0.01 for this node's options; the API quotes up to 0.03 with speakers and chapters | none |
| Text | Translate (English and 14 languages) | text | 0.003 | 5 per IP per day (shared mlpeek pool) |
| Utility | Verify Email Address (syntax and DNS, no mailbox probe) | email | 0.001 | 5 per IP per day (shared pool) |

Prices and limits come from <https://tanod.dev/openapi.json> and may change. This node does not expose the API's `speakers` or `chapters` options; its speech-to-text call is USD 0.01. The live OpenAPI spec and 402 quote are authoritative.
Operations that return a file (screenshot, PDF to Word, Office to PDF, PDF tables as CSV/XLSX) put it in n8n
binary data (`data`, `data2`, ...) and keep the metadata in JSON. Binary inputs are read from the field you name
(default `data`), so the node chains directly after Read Binary File, HTTP Request or a trigger with attachments.

## Payment

1. **Default: free allowance.** On routes that have one, the node sends `X-Tanod-Free: 1`. The allowance is per
   IP address per UTC day, so a shared n8n server uses it up quickly.
2. **When the allowance is gone, or the route has none (HTTP 402):**
   - without a wallet the node stops with an error that states the price and how to add the credential;
   - with the **Tanod x402 wallet** credential, the node signs an x402 payment with the official
     `@x402/fetch` and `@x402/evm` clients and retries once.

### Tanod x402 wallet credential

Paste an EVM private key (`0x...`) of a **dedicated wallet** that holds a few dollars of USDC on Base. No ETH is
needed for the payment itself. Use a throwaway wallet, never your main one. The key is stored by n8n as a
credential, is used only to sign payments to the price Tanod quotes, and is never logged or written to output.
The node option **Max Price per Call** (default USD 0.05) refuses any quote above it. Each paid call is a
separate on-chain-settled USDC transfer; if a call fails, you are not charged.

Card credits are not supported yet.

## Build from source

```bash
npm install
npm run build   # tsc -> dist/
npm test        # loads the built node, 1 live free-tier call, plus a mock wallet payment
```

## Licence

MIT.
