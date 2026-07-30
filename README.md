# Kagen AI Chatbot

Production-oriented Next.js chatbot and embeddable website widget grounded
strictly in Kagen's published WordPress content.

> **Developer and AI handoff:** Read this file completely before changing the
> project. It documents the current architecture, important constraints, source
> files, APIs, retrieval behavior, setup, tests, widget lifecycle, and deployment.
> Inspect only the focused files listed for the task after reading this document.

## Current status

Last verified: **24 July 2026**

- Next.js `16.2.11`, App Router, React, TypeScript, Zod.
- AI provider: NVIDIA NIM through its OpenAI-compatible API.
- Active model configuration: `meta/llama-3.1-8b-instruct`.
- WordPress is the only knowledge source. There is no hardcoded production
  content and no generic-answer fallback.
- Local WordPress inventory at last verification: 72 published objects
  (13 pages, 42 posts, 13 case studies, 3 products, and 1 event).
- Complete `content.rendered`, `excerpt.rendered`, title, and recursive ACF data
  are indexed.
- Mid-article sentences, partial phrases, keywords, and supported paraphrases
  are retrievable.
- Primary brand color is `#0063ce`.
- The widget supports Next.js preview, WordPress, static HTML, and other sites.
- Latest quality gate: 38 tests, ESLint, TypeScript, and production build pass.

### Current Vercel deployment

- Production app: `https://kagen-ai-chatbot.vercel.app`
- Health, widget loader, and widget preview return HTTP 200.
- The production chat currently returns `CONTENT_UNAVAILABLE` because
  `https://kagen.ai/wp-json/kagen/v1/content` returns WordPress 404 and the live
  REST index does not list the `kagen/v1` namespace.
- Activate/deploy the Kagen REST API route on live WordPress before treating
  production chat as operational. Do not replace it with hardcoded content.

## Non-negotiable product rules

Keep these invariants unless the owner explicitly requests a change:

1. WordPress API content is the sole source of factual Kagen answers.
2. Never add hardcoded product, article, company, or marketing fallback content.
3. Never search titles only.
4. Search every published WordPress object and all recursive ACF values.
5. Never invent URLs, capabilities, prices, customers, claims, or metrics.
6. If retrieval finds no reliable evidence, respond exactly:

   ```text
   I could not find reliable information in the available Kagen website content.
   ```

7. If WordPress or the LLM is unavailable, return an explicit service error;
   do not silently generate a generic answer.
8. Keep `AI_API_KEY` server-only. Never expose it through `NEXT_PUBLIC_*`,
   browser JavaScript, cards, logs, or documentation.
9. Preserve existing `/api/chat`, `/embed`, and widget-loader contracts.
10. Product/detail chips and suggestions must trigger real API-backed behavior.
11. Disabled pages must not be substituted; use only currently published API
    content.

## Quick start

Requirements:

- Current Node.js LTS
- npm
- Local or public access to the Kagen WordPress API
- Valid NVIDIA/OpenAI-compatible API key

This project currently uses the root `.env` file as its active local
configuration.

```bash
npm install
npm run dev
```

Open:

- Application: `http://localhost:3000`
- Widget configurator: `http://localhost:3000/widget-preview`
- Static widget test: `http://localhost:3000/widget-test.html`
- Health check: `http://localhost:3000/api/health`

Before handing off a change:

```bash
npm run format
npm test -- --run
npm run lint
npm run typecheck
npm run build
```

## Environment

Use `.env.example` as the public template. Never commit a real key.

```env
NEXT_PUBLIC_APP_NAME=Kagen AI Assistant

KAGEN_API_BASE_URL=http://localhost/wp-kagen/wp-json/kagen/v1
KAGEN_PUBLIC_SITE_URL=http://localhost/wp-kagen

AI_PROVIDER=nvidia
AI_MODEL=meta/llama-3.1-8b-instruct
AI_BASE_URL=https://integrate.api.nvidia.com/v1
AI_API_KEY=replace-with-a-server-side-secret

ALLOWED_ORIGINS=http://localhost:3000,https://kagen.ai,https://www.kagen.ai
WIDGET_ALLOWED_ORIGINS=http://localhost:3000,https://kagen.ai,https://www.kagen.ai
NEXT_PUBLIC_CHAT_API_URL=/api/ag-ui
```

| Variable                   | Use                                                |
| -------------------------- | -------------------------------------------------- |
| `KAGEN_API_BASE_URL`       | Server-side Kagen REST API root                    |
| `KAGEN_PUBLIC_SITE_URL`    | Rewrites local WP links to the correct public site |
| `AI_PROVIDER`              | Provider identifier (`nvidia` is active)           |
| `AI_MODEL`                 | OpenAI-compatible model ID                         |
| `AI_BASE_URL`              | OpenAI-compatible API base                         |
| `AI_API_KEY`               | Server-only provider secret                        |
| `ALLOWED_ORIGINS`          | Exact origins accepted by application APIs         |
| `WIDGET_ALLOWED_ORIGINS`   | Exact external widget host origins                 |
| `NEXT_PUBLIC_CHAT_API_URL` | Browser AG-UI endpoint, normally `/api/ag-ui`      |

Compatibility aliases `LLM_PROVIDER`, `LLM_MODEL`, and `LLM_API_KEY` remain
supported in `src/lib/env.ts`.

### Production environment

```env
KAGEN_API_BASE_URL=https://kagen.ai/wp-json/kagen/v1
KAGEN_PUBLIC_SITE_URL=https://kagen.ai
AI_PROVIDER=nvidia
AI_MODEL=meta/llama-3.1-8b-instruct
AI_BASE_URL=https://integrate.api.nvidia.com/v1
AI_API_KEY=replace-with-production-secret
ALLOWED_ORIGINS=https://kagen.ai,https://www.kagen.ai
WIDGET_ALLOWED_ORIGINS=https://kagen.ai,https://www.kagen.ai
NEXT_PUBLIC_CHAT_API_URL=/api/ag-ui
```

A Vercel deployment cannot access WordPress running on a developer's
`localhost`. Production must use a publicly reachable HTTPS WordPress endpoint.

## System flow

```text
User message
  → official AG-UI HttpAgent
  → POST /api/ag-ui with RunAgentInput
  → RUN_STARTED event
  → grounded `/api/chat` orchestration
  → Zod request validation
  → exact-origin CORS + rate limiting
  → fetch all published WordPress objects
  → recursive full-content extraction
  → paragraph-preserving overlapping chunks
  → relevance ranking across the complete index
  → Top 5 documents/chunks
  → all retrieved chunks sent to the configured LLM
  → strict grounded JSON response
  → server-generated WordPress cards and source links
  → Zod response validation
  → streaming TEXT_MESSAGE_* + kagen.ui.response events
  → RUN_FINISHED or authoritative RUN_ERROR event
  → chatbot UI
```

## Retrieval system

The current retrieval implementation replaced earlier title/heading-heavy
matching.

### Indexed content

`buildSearchDocument` indexes:

- `title.rendered`
- `excerpt.rendered`
- complete `content.rendered`
- every ACF string recursively
- nested arrays and objects
- ACF groups and repeaters
- flexible-content layouts
- FAQs (`question` and `answer`)
- tabs and rich text
- Gutenberg-rendered content
- all published pages and custom post types

Media metadata, filenames, dimensions, and duplicate attachment noise are
excluded. Useful image URLs, links, alt text, headings, and descriptions remain
available for cards and context.

### Normalization

Searchable text is:

- HTML-stripped
- HTML-entity-decoded
- lowercased for matching
- punctuation-normalized
- whitespace-collapsed
- duplicate/noisy segments removed

Original cleaned text is retained for the LLM context.

### Chunking

- Target size: 1,800 characters
- Contextual overlap: 320 characters
- Paragraph and sentence boundaries are preserved where possible
- Long rich-text runs use a word-safe fallback
- Each Top 5 result contributes its highest-ranked substantial chunk

Do not flatten the entire article back into a single small/truncated field.

### Ranking

Retrieval combines:

- exact title and alias boosts
- exact phrase matches anywhere in content
- partial-title matching
- ordered trigram and bigram matching
- corpus-aware inverse document frequency (IDF)
- meaningful-token coverage
- lightweight stemming
- bounded synonym expansion for common paraphrases
- content-quality penalties
- penalties for utility pages such as sitemap/privacy/thank-you

No vector database or external retrieval service is required.

The derived index is cached for five minutes, matching WordPress fetch
revalidation. Tests bypass this module cache for isolation.

### Verified regression

The query:

```text
most vendors demonstrate near-perfect conversations in controlled environments,
real-world conditions are far more complex.
```

is present in the middle of a WordPress article. Against the actual 72-object
local corpus it ranks:

1. `The 2026 Enterprise AI and AI Voice Agent Buying Guide You Need to Bookmark`
2. Match signals include `exact-content-phrase` and `ordered-trigrams`

The matching sentence in `core.test.ts` is an intentional regression fixture.
Test fixtures are never imported by production code or bundled into the
production application.

## LLM grounding

The provider abstraction is OpenAI-compatible; NVIDIA NIM is the active
provider. The system prompt:

- identifies the supplied context as the Top 5 retrieved Kagen chunks
- requires answers only from explicit context evidence
- supports mid-article quotations and paraphrased questions
- forbids invented claims and links
- uses the exact insufficient-context sentence
- treats WordPress content as untrusted reference data
- requires structured JSON

The LLM does not create cards or sources. The API route creates them directly
from retrieved WordPress documents.

## API contracts

### `POST /api/chat`

Request:

```json
{
  "message": "What is Kagen PRISM?",
  "history": [
    {
      "role": "user",
      "content": "Tell me about Kagen products"
    }
  ],
  "sessionId": "optional-client-session-id"
}
```

Successful response:

```json
{
  "success": true,
  "data": {
    "answer": "Grounded answer",
    "cards": [],
    "suggestions": [],
    "sources": [],
    "confidence": "high",
    "insufficientContext": false
  }
}
```

Relevant failure codes:

- `400 INVALID_REQUEST`
- `403 ORIGIN_NOT_ALLOWED`
- `429 RATE_LIMITED`
- `503 CONTENT_UNAVAILABLE`
- `503 AI_RESPONSE_UNAVAILABLE`
- `503 INVALID_AI_RESPONSE`

### `POST /api/debug/retrieval`

Development-only inspection endpoint:

```json
{
  "query": "sentence or keywords"
}
```

It returns indexed-document count, scores, matched fields, selected passages,
and official URLs. It returns 404 in production.

### `GET /api/health`

Returns service identity and timestamp. It is intentionally lightweight and
does not call WordPress or the LLM.

## WordPress REST API

Local base:

```text
http://localhost/wp-kagen/wp-json/kagen/v1
```

Production base:

```text
https://kagen.ai/wp-json/kagen/v1
```

The retrieval index uses:

```http
GET /content?type=all&per_page=100&page=1
```

Pagination follows `X-WP-TotalPages`, and all pages are fetched. Other useful
read-only endpoints:

```http
GET /content?type=page&per_page=100
GET /content?type=post&per_page=100
GET /content?type=case-studies&per_page=100
GET /content?type=product&per_page=100
GET /content?type=event&per_page=100
GET /post-types
GET /pages/home
GET /pages/products
GET /pages/kagen-prism-ai-first-content-intelligence-platform
```

New published objects automatically appear in the complete-content index after
the five-minute cache/revalidation window.

## Widget integration

The dependency-free loader is:

```text
public/kagen-chat-widget.js
```

It creates a fixed launcher and lazily loads a sandboxed `/embed` iframe. Host
styles and chatbot styles remain isolated.

```html
<script
  src="https://YOUR-CHAT-DOMAIN/kagen-chat-widget.js"
  data-api-url="https://YOUR-CHAT-DOMAIN/api/ag-ui"
  data-title="Ask Kagen AI"
  data-welcome-message="Hi! How can I help you explore Kagen?"
  data-primary-color="#0063ce"
  data-position="bottom-right"
  data-button-label="Chat with Kagen"
  data-width="400"
  data-height="650"
  data-open-by-default="false"
  defer
></script>
```

Supported attributes:

- `data-api-url`
- `data-title`
- `data-welcome-message`
- `data-primary-color`
- `data-position` (`bottom-right` or `bottom-left`)
- `data-button-label`
- `data-logo-url`
- `data-open-by-default`
- `data-z-index`
- `data-width` (320–520)
- `data-height` (450–850)
- `data-mobile-fullscreen`
- `data-allowed-domain`

Public API:

```js
window.KagenChat.open();
window.KagenChat.close();
window.KagenChat.toggle();
window.KagenChat.isOpen();
window.KagenChat.destroy();
```

### Close behavior

There are two visible close interactions:

- The launcher becomes a working close button while open.
- The header X inside the iframe sends `KAGEN_CHAT_CLOSE`.

The loader also places a parent-controlled transparent hit area over the visible
header X. This guarantees closing when a host page is opened directly through
`file://`, where browsers use an opaque `"null"` origin and iframe messaging
can be inconsistent. The parent still validates widget message origin and
iframe source for normal message handling.

### Static HTML testing

The host HTML may be opened directly, but the chatbot application must still be
available at the URLs used by the script and API:

```html
<script
  src="http://localhost:3000/kagen-chat-widget.js?v=2"
  data-api-url="http://localhost:3000/api/ag-ui"
  data-primary-color="#0063ce"
  defer
></script>
```

For local use, run `npm run dev`. In production, replace localhost with the
deployed chatbot domain. An HTTPS host cannot load an HTTP widget because the
browser blocks mixed content.

### WordPress installation

Recommended enqueue method:

```php
function kagen_enqueue_ai_chat_widget() {
  wp_enqueue_script(
    'kagen-ai-chat-widget',
    'https://YOUR-CHAT-DOMAIN/kagen-chat-widget.js',
    array(),
    null,
    true
  );
}
add_action('wp_enqueue_scripts', 'kagen_enqueue_ai_chat_widget');

function kagen_chat_widget_attributes($tag, $handle) {
  if ('kagen-ai-chat-widget' !== $handle) {
    return $tag;
  }

  return str_replace(
    ' src=',
    ' data-api-url="https://YOUR-CHAT-DOMAIN/api/ag-ui" data-title="Ask Kagen AI" data-primary-color="#0063ce" data-position="bottom-right" src=',
    $tag
  );
}
add_filter('script_loader_tag', 'kagen_chat_widget_attributes', 10, 2);
```

Use a child theme or site-specific plugin so theme updates do not remove it.

### Widget events

Host events:

- `kagen-chat:ready`
- `kagen-chat:open`
- `kagen-chat:close`
- `kagen-chat:error`
- `kagen-chat:message-submitted`
- `kagen-chat:response-received`
- `kagen-chat:api-error`
- `kagen-chat:link-clicked`

Analytics events contain categories/metadata, not the user's message content.

## User interface decisions

- Primary color: `#0063ce`
- Assistant avatar and assistant content: left side
- User avatar and user bubble: right side
- Text inside both assistant and user bubbles: left-aligned
- Cards, sources, chips, and input text: left-aligned
- Horizontal overflow is hidden inside the conversation
- The widget has one visually apparent header X and a launcher close state

## Source map

Read only the relevant files after this README:

| Concern                       | Primary files                                     |
| ----------------------------- | ------------------------------------------------- |
| Chat API orchestration        | `src/app/api/chat/route.ts`                       |
| Retrieval and ranking         | `src/lib/search-retriever.ts`                     |
| Document index and chunking   | `src/lib/search-index.ts`                         |
| Recursive ACF extraction      | `src/lib/acf-extractor.ts`                        |
| HTML/entity normalization     | `src/lib/html-utils.ts`                           |
| WordPress fetching/pagination | `src/lib/kagen-api.ts`                            |
| Environment validation        | `src/lib/env.ts`                                  |
| LLM prompt/provider           | `src/lib/llm/openai-provider.ts`                  |
| LLM interface                 | `src/lib/llm/provider.ts`, `src/lib/llm/types.ts` |
| Response schema               | `src/lib/llm/schemas.ts`                          |
| Chat state/UI                 | `src/components/chat/chat-window.tsx`             |
| Message rendering             | `src/components/chat/chat-message.tsx`            |
| Cards                         | `src/components/chat/result-card.tsx`             |
| Embed server page             | `src/app/embed/page.tsx`                          |
| Widget configurator           | `src/app/widget-preview/page.tsx`                 |
| Widget loader                 | `public/kagen-chat-widget.js`                     |
| Global/widget styling         | `src/app/globals.css`                             |
| Retrieval/unit tests          | `src/lib/core.test.ts`                            |
| Loader/jsdom tests            | `src/lib/widget-loader.test.ts`                   |

Legacy helpers such as `content-retriever.ts`, `content-normalizer.ts`, and
`relevance-score.ts` support older/API-specific flows and tests. The primary
chat endpoint uses `search-retriever.ts`.

## Security model

- Server-side API keys only
- Exact-origin CORS; no wildcard API CORS response
- Input, history, output, URLs, and array sizes validated with Zod
- WordPress and AI calls have timeouts
- Model context is treated as untrusted data
- Model output cannot determine final cards/source URLs
- Raw WordPress HTML is converted to text before search or display
- Embed iframe is sandboxed
- Widget message handling validates namespace, type, origin, and source
- Chat responses use `Cache-Control: no-store`
- Basic in-memory per-instance rate limiting is enabled

For distributed production rate limiting, replace the in-memory limiter with a
shared service such as Vercel KV/Upstash without changing the API contract.

## Deployment

Repository:

```text
https://github.com/gajendrayaduwanshii/kagenAiChatbot.git
```

Vercel steps:

1. Import the GitHub repository.
2. Add every required environment variable.
3. Use the public HTTPS Kagen WordPress API.
4. Keep `AI_API_KEY` in server-side environment settings.
5. Add every real host to both allowed-origin lists as appropriate.
6. Deploy using the standard `npm run build`.
7. Verify `/api/health`.
8. Test a title, mid-article sentence, paraphrase, unknown query, and widget
   close/open behavior.
9. Copy the generated script from `/widget-preview` into the target website.

## Troubleshooting

### Widget does not appear

- Confirm the chatbot server/domain is reachable.
- Open the script URL directly and check for HTTP 200.
- Check browser mixed-content and Content Security Policy errors.
- Add a query version such as `?v=2` to bypass an old cached loader.

### Header X does not close

- Hard-refresh the host page.
- Confirm it is serving the latest `kagen-chat-widget.js`.
- Verify the parent-controlled `.kagen-chat-close-hit-area` exists.
- Confirm the host has not placed another element above the widget z-index.

### Content exists but is not found

1. Call `/api/debug/retrieval` in development.
2. Confirm `indexedDocuments` matches the WordPress inventory.
3. Inspect `selectedPassages` and `matchedFields`.
4. Confirm the text exists in `content.rendered` or ACF in the API response.
5. Add a regression fixture before changing thresholds.
6. Do not solve the issue by hardcoding production answers.

### LLM response unavailable

- Verify `AI_API_KEY`, `AI_MODEL`, and `AI_BASE_URL`.
- Confirm model access in the NVIDIA account.
- Confirm the provider returns valid JSON.

### Local works but Vercel fails

- Vercel cannot access local WordPress.
- Use `https://kagen.ai/wp-json/kagen/v1`.
- Verify allowed origins and TLS.

### Stale WordPress content

Content and the derived index refresh every five minutes. Restart the local
development process for an immediate clean local check.

## AI/developer change checklist

Before changing code:

1. Read this README.
2. Identify the focused files from the source map.
3. Preserve API and widget contracts.
4. Preserve strict WordPress grounding.
5. Check existing dirty worktree changes before editing.

Before completing:

1. Add/update a regression test for behavior changes.
2. Run format, tests, lint, and typecheck.
3. Run the production build.
4. For retrieval changes, test against the real local WordPress corpus.
5. For widget changes, test launcher and header close behavior.
6. Update this README if architecture, configuration, or behavior changed.
