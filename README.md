# Kagen AI Assistant

A production-oriented Next.js website assistant grounded in content from Kagen's WordPress REST API. It provides conversational Markdown answers, dynamically generated content cards, source links, suggestions, a full-page chat, and a floating-widget preview.

## Architecture

- Next.js App Router with React Server Components for page shells and client components only for chat interaction.
- `POST /api/chat` validates requests, enforces CORS/rate limits, detects intent, retrieves only relevant WordPress content, normalizes/ranks it, and invokes a provider-independent LLM layer.
- WordPress responses—including arbitrary nested ACF values—are converted into bounded plain text. Raw HTML is never rendered.
- OpenAI is isolated behind `LLMProvider`. Model output is Zod-validated and all card/source URLs are checked against retrieved URLs.
- Strict mode returns an explicit error if WordPress content is unavailable or the LLM response cannot be validated; it never substitutes a generic fallback answer.
- Public WordPress fetches revalidate every five minutes; chat responses use `no-store`.

## Local setup

Requirements: a current Node.js LTS release, npm, and access to the Kagen WordPress API.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The widget preview is at `/widget-preview`; health is at `/api/health`.

## Environment variables

| Name                       | Purpose                                  |
| -------------------------- | ---------------------------------------- |
| `NEXT_PUBLIC_APP_NAME`     | Public UI name                           |
| `KAGEN_API_BASE_URL`       | Server-only WordPress API base           |
| `KAGEN_PUBLIC_SITE_URL`    | Public base for card and source URLs     |
| `AI_PROVIDER`              | Provider selector; `nvidia` or `openai`  |
| `AI_API_KEY`               | Server-only provider secret              |
| `AI_MODEL`                 | Provider model ID                        |
| `AI_BASE_URL`              | Optional OpenAI-compatible API base URL  |
| `ALLOWED_ORIGINS`          | Comma-separated exact origins            |
| `NEXT_PUBLIC_CHAT_API_URL` | Browser chat route, normally `/api/chat` |

Never prefix the AI key with `NEXT_PUBLIC_`.

### WordPress

For local WordPress use:

```env
KAGEN_API_BASE_URL=http://localhost/wp-kagen/wp-json/kagen/v1
KAGEN_PUBLIC_SITE_URL=http://localhost/wp-kagen
```

For production:

```env
KAGEN_API_BASE_URL=https://kagen.ai/wp-json/kagen/v1
KAGEN_PUBLIC_SITE_URL=https://kagen.ai
```

The configured WordPress routes must be reachable from the Next.js server. A WordPress instance on `localhost` cannot be reached by a Vercel deployment; Vercel testing requires a publicly accessible HTTPS endpoint.

### LLM

For NVIDIA NIM, set `AI_PROVIDER=nvidia`, `AI_BASE_URL=https://integrate.api.nvidia.com/v1`, `AI_API_KEY`, and a model such as `meta/llama-3.1-8b-instruct` in `AI_MODEL`. OpenAI-compatible providers use the same isolated adapter. A valid key is required; strict mode does not generate fallback answers.

## Commands

```bash
npm run dev
npm run test
npm run lint
npm run typecheck
npm run build
npm start
```

## Deploying to Vercel

1. Import the repository in Vercel.
2. Add every `.env.example` value in Project Settings → Environment Variables, using a public HTTPS WordPress URL.
3. Keep `LLM_API_KEY` server-side and apply it only to appropriate environments.
4. Deploy; Vercel detects Next.js and runs `npm run build`.
5. Test `/api/health`, `/api/chat`, the home page, and `/widget-preview`.

## Security notes

Inputs, history, structured model output, and URLs are bounded and validated. The route uses exact-origin CORS, server-side secrets, request timeouts, safe client rendering, prompt-injection guidance, and sanitized WordPress context. The included in-memory IP limiter is a basic per-instance safeguard only; use Upstash or Vercel KV for distributed production enforcement. No personal data is intentionally collected, and the browser session ID is random and currently used only as optional request metadata.

## Widget integration

The production widget is a small dependency-free loader at `/kagen-chat-widget.js`. It creates a launcher immediately and lazily creates a sandboxed `/embed` iframe when opened, isolating the host page from the chat application’s styles and dependencies.

```html
<script
  src="https://YOUR-VERCEL-DOMAIN.vercel.app/kagen-chat-widget.js"
  data-api-url="https://YOUR-VERCEL-DOMAIN.vercel.app/api/chat"
  data-title="Ask Kagen AI"
  data-welcome-message="Hi! How can I help you explore Kagen?"
  data-primary-color="#0063CE"
  data-position="bottom-right"
  data-button-label="Chat with Kagen"
  data-allowed-domain="kagen.ai"
  defer
></script>
```

The simplified form uses safe defaults:

```html
<script
  src="https://YOUR-VERCEL-DOMAIN.vercel.app/kagen-chat-widget.js"
  defer
></script>
```

Supported data attributes are `api-url`, `title`, `welcome-message`, `primary-color`, `position`, `button-label`, `logo-url`, `open-by-default`, `z-index`, `width`, `height`, `mobile-fullscreen`, and `allowed-domain`. Dimensions are bounded (320–520px wide and 450–850px high), colors must be six-digit hex, and remote URLs must use HTTPS.

The one documented global is:

```js
window.KagenChat.open();
window.KagenChat.close();
window.KagenChat.toggle();
window.KagenChat.isOpen();
window.KagenChat.destroy();
```

The loader dispatches `kagen-chat:ready`, `kagen-chat:open`, `kagen-chat:close`, and `kagen-chat:error`. The chat also dispatches privacy-friendly `kagen-chat:message-submitted`, `kagen-chat:response-received`, `kagen-chat:api-error`, and link interaction events without including message content.

### WordPress installation

**Method 1 — theme footer**

```php
function kagen_add_ai_chat_widget() {
?>
<script
  src="https://YOUR-VERCEL-DOMAIN.vercel.app/kagen-chat-widget.js"
  data-api-url="https://YOUR-VERCEL-DOMAIN.vercel.app/api/chat"
  data-title="Ask Kagen AI"
  data-primary-color="#0063CE"
  data-position="bottom-right"
  defer
></script>
<?php
}
add_action('wp_footer', 'kagen_add_ai_chat_widget');
```

Place this in a child theme or site-specific plugin so theme updates do not remove it.

**Method 2 — WordPress enqueue API (recommended)**

```php
function kagen_enqueue_ai_chat_widget() {
  wp_enqueue_script(
    'kagen-ai-chat-widget',
    'https://YOUR-VERCEL-DOMAIN.vercel.app/kagen-chat-widget.js',
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
    ' data-title="Ask Kagen AI" data-primary-color="#0063CE" data-position="bottom-right" src=',
    $tag
  );
}
add_filter('script_loader_tag', 'kagen_chat_widget_attributes', 10, 2);
```

**Method 3 — header/footer script feature**

Use a trusted header/footer custom-code facility already approved for the site. Paste the script immediately before the closing `</body>` tag. No paid plugin is required.

### Static HTML, Webflow, and React

For static HTML or Webflow, paste the standard script immediately before `</body>`. In Webflow this goes in Project/Page Settings → Custom Code → Before `</body>`.

React component:

```tsx
import { useEffect } from "react";

export function KagenChatWidget() {
  useEffect(() => {
    if (document.querySelector("[data-kagen-widget-loader]")) return;
    const script = document.createElement("script");
    script.src = "https://YOUR-VERCEL-DOMAIN.vercel.app/kagen-chat-widget.js";
    script.defer = true;
    script.dataset.kagenWidgetLoader = "true";
    script.dataset.primaryColor = "#0063CE";
    document.body.appendChild(script);
    return () => {
      window.KagenChat?.destroy();
      script.remove();
    };
  }, []);
  return null;
}
```

The script handles duplicate inclusion, late or dynamic loading, and lazy iframe initialization. For long-lived SPA layouts, mount it once at the application shell.

### Content Security Policy

Replace the placeholder with the deployed widget origin and merge these sources into the host’s existing policy:

```text
script-src 'self' https://YOUR-VERCEL-DOMAIN.vercel.app;
style-src 'self' 'unsafe-inline';
frame-src https://YOUR-VERCEL-DOMAIN.vercel.app;
connect-src 'self' https://YOUR-VERCEL-DOMAIN.vercel.app;
img-src 'self' data: https://YOUR-VERCEL-DOMAIN.vercel.app https://kagen.ai;
```

The loader currently creates a small scoped inline stylesheet, so a nonce-based host policy must either permit that style or serve an equivalent approved style policy. `connect-src` is required by the iframe application’s own CSP only when the API lives on a separate origin. Add WordPress image hosts to `img-src` when cards use remote featured images.

### Local and mixed-content behavior

Use `http://localhost:3000/kagen-chat-widget.js` for local testing. An HTTPS host page will block an HTTP widget/API as mixed content. Vercel also cannot reach WordPress on the developer’s `localhost`; production must use a publicly accessible HTTPS WordPress API.

Cross-origin chat requests require the exact host origin in `WIDGET_ALLOWED_ORIGINS`. The application never responds with wildcard CORS.

## Vercel production deployment

1. Push the repository to GitHub.
2. Import it into Vercel.
3. Add the environment variables below.
4. Set `KAGEN_API_BASE_URL` to the public production WordPress endpoint.
5. Configure the AI provider key, model, and compatible base URL.
6. Add every widget host to `WIDGET_ALLOWED_ORIGINS`.
7. Deploy.
8. Verify `/api/health`.
9. Test `/widget-preview`.
10. Copy the generated script into the target website.

Example configuration (never commit real secrets):

```env
KAGEN_API_BASE_URL=https://kagen.ai/wp-json/kagen/v1
KAGEN_PUBLIC_SITE_URL=https://kagen.ai
AI_PROVIDER=nvidia
AI_API_KEY=replace-with-secret
AI_MODEL=meta/llama-3.1-8b-instruct
AI_BASE_URL=https://integrate.api.nvidia.com/v1
ALLOWED_ORIGINS=https://kagen.ai,https://www.kagen.ai
WIDGET_ALLOWED_ORIGINS=https://kagen.ai,https://www.kagen.ai
NEXT_PUBLIC_APP_NAME=Kagen AI Assistant
NEXT_PUBLIC_CHAT_API_URL=/api/chat
```

`LLM_PROVIDER`, `LLM_API_KEY`, and `LLM_MODEL` remain supported as compatibility aliases. No local filesystem persistence or custom Node server is used; the API routes are serverless-compatible and the loader is served statically from `public`.

## Troubleshooting

- **Content unavailable:** verify `KAGEN_API_BASE_URL`, route availability, TLS, and that the Next.js host can reach WordPress.
- **Verified answer unavailable:** check `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, account access, and server logs.
- **Origin rejected:** add the exact scheme/host/port to `ALLOWED_ORIGINS`.
- **Localhost works but Vercel fails:** Vercel cannot access the WordPress server on your computer; use a public HTTPS endpoint.
- **Stale content:** public content revalidates after five minutes; restart development for immediate local checks.

# kagenAiChatbot
