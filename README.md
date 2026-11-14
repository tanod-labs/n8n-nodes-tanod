# n8n-nodes-tanod

Open source (MIT) n8n community node for [Tanod](https://tanod.dev): document, web, audio, text and email tools.
Use a prepaid credit key for paid calls without storing a wallet in n8n, or keep using the free allowances
and optional [x402](https://x402.org) wallet payments.

> Results are automated and heuristic. Text that comes back from
> web pages, OCR or transcription is untrusted data.

More: <https://tanod.dev/connect/> (MCP and other ways to connect) and <https://tanod.dev/pricing>.

## Install (self-hosted n8n)

This is an unverified community node; n8n has not reviewed it.

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
| Audio | Speech to Text (text, segments, SRT, WebVTT; up to 10 min / 25 MB) | binary or URL | 0.01 | none |
| Text | Translate (English and 14 languages) | text | 0.003 | 5 per IP per day (shared mlpeek pool) |
| Utility | Verify Email Address (syntax and DNS, no mailbox probe) | email | 0.001 | 5 per IP per day (shared pool) |

Prices and limits come from <https://tanod.dev/openapi.json> and may change; the live values are on the pricing page.
Operations that return a file (screenshot, PDF to Word, Office to PDF, PDF tables as CSV/XLSX) put it in n8n
binary data (`data`, `data2`, ...) and keep the metadata in JSON. Binary inputs are read from the field you name
(default `data`), so the node chains directly after Read Binary File, HTTP Request or a trigger with attachments.

## Payment

### Prepaid credit key setup

1. Follow [Tanod prepaid credits](https://tanod.dev/credits/) to obtain a funded `tnd_` key. Save the key when it
   is shown; treat it as a secret. Check that page for available funding methods. Funding currently uses x402;
   using an already funded key for calls does **not** require a wallet in n8n.
2. Add a **Tanod** node and choose **Payment Mode > Prepaid Credit Key**.
3. Create a **Tanod Prepaid Credit Key API** credential and paste the complete key into **Credit Key**.
   The credential test checks the balance without running a paid tool. Set the credential's **Allowed HTTP Request
   Domains** to **tanod.dev**: this credential can also be selected in n8n's HTTP Request node.
4. Choose an operation, supply its input and execute the node. Returned files still appear in binary field `data`.

The credential sends `Authorization: Bearer <key>`. The API also accepts `X-Tanod-Credits: <key>`; do not add
both headers or put a key in workflow JSON, a URL, an expression, or an input field. n8n stores the key as a credential.

Credit mode pays the listed route price from the key's balance. It does **not** use the free daily allowance,
apply the wallet-only **Max Price per Call** option, sign a wallet payment, top up automatically, or fall back to
another payment method. Check current prices before executing a batch. Invalid/revoked keys return 401.
A 402 with `credits_insufficient` means insufficient balance; other 402 responses mean credit payment was not
accepted by the service. The node does not retry credit calls automatically. After a timeout or lost response,
check the balance before retrying. Redirects are refused.

Unused credit expires 12 months after the purchase that added it. See the credits page for purchase terms,
balance checks and lost-key support. This package does not purchase or recover keys.

### Control spending in workflows

- Each input item is one paid call in credit mode. **Loop Over Items** and **Split in Batches** multiply calls
  when they send or repeat items through the node.
- n8n's **Retry On Fail** resends paid calls. Do not enable it on paid calls.
- Retrying an execution and **Execute step** make real paid calls; they are not previews.
- **usableAsTool** lets an **AI Agent** call this node many times, including when steered by untrusted text
  from web pages, documents or other tool results. Do not give untrusted text authority to request paid work.
- The key's balance is the only spending limit: fund a key with only what you are willing to spend.

### Existing free and wallet workflows

**Free Allowance / X402 Wallet** remains the default, including workflows saved before credit support:

1. On routes that have a free allowance, the node sends `X-Tanod-Free: 1` by default. The allowance is per IP
   address per UTC day, so a shared n8n server shares it.
2. When the allowance is gone, or the route has none (HTTP 402):
   - without a wallet the node stops with an error that states the price and how to add the credential;
   - with the **Tanod x402 wallet** credential, the node uses the pinned x402 clients and retries with payment.

### Tanod x402 wallet credential

Paste an EVM private key (`0x...`) of a **dedicated wallet** that holds a few dollars of USDC on Base. No ETH is
needed for the payment itself. Use a throwaway wallet, never your main one. The key is stored by n8n as a
credential, is used only to sign payments to the price Tanod quotes, and is never logged or written to output.
The node option **Max Price per Call** (default USD 0.05) caps the actual SDK-selected payment in atomic
USDC (6 decimals), not a display price or the cheapest item in an offer array. A changed quote is checked
again inside the pinned SDK policy and immediately before payment creation; only exact USDC on Base and
an initially vetted payee/transfer method are allowed. Missing/malformed terms fail closed, and fractional
micro-dollar limits are rounded down. Redirects are refused on both free and paid requests, so payment
headers cannot be forwarded to a different URL or lost in a redirect loop.

Each paid call is a separate transfer authorization. A failed or lost response after submission is not proof
that no payment settled. Do not blindly pay again for an unresolved operation.

## Example workflow

Import the following synthetic workflow into self-hosted n8n, open **Tanod**, and select your own credit
credential. No credential or secret is included. Each execution runs one paid document conversion.

```json
{
  "name": "Tanod credit-key example",
  "nodes": [
    {
      "parameters": {},
      "id": "manual",
      "name": "Run Example",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0]
    },
    {
      "parameters": {
        "paymentMode": "credits",
        "resource": "document",
        "operation": "toMarkdown",
        "inputSource": "url",
        "url": "https://example.com/"
      },
      "id": "tanod",
      "name": "Tanod",
      "type": "n8n-nodes-tanod.tanod",
      "typeVersion": 1,
      "position": [280, 0]
    }
  ],
  "connections": {
    "Run Example": {
      "main": [[{ "node": "Tanod", "type": "main", "index": 0 }]]
    }
  },
  "settings": {},
  "active": false
}
```

## Build from source

```bash
npm ci --ignore-scripts
npm run build
npm run lint
npm test
```

Tests are offline by default: mocked credit responses, wallet spend-cap regressions, node input/output and a
packed-package check. The optional live free-tier check is not part of the offline suite.

There are no npm runtime dependencies apart from n8n's provided `n8n-workflow` peer. The wallet compatibility
code is bundled at build time, with third-party license notices included in the package. Free and credit mode
do not load that bundle. `npm run lint` is a TypeScript check, **not** n8n verification. This package is not
verified for n8n Cloud; bundling dependencies alone does not establish compliance with n8n's verification rules.

## Release configuration

For release maintainers, the publish workflow uses the **npm-publish** GitHub environment. Configure required
reviewers for that environment and bind the npm trusted publisher to the same **npm-publish** environment and
**publish.yml** workflow. Only a version-matching tag whose commit is on the history of `main` can release.
The build job has no publish identity; a separate publish-only job publishes the exact tested npm tarball.
The optional **NPM_TOKEN** fallback is temporary: remove it once trusted publishing works.

## Licence

Open source (MIT). Bundled wallet code retains its third-party licenses.
