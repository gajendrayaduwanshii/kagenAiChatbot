# Kagen AI Chatbot — Project Overview

## 1. Project Summary

Kagen AI Chatbot is an AI-powered website assistant that answers questions
about Kagen's products, blogs, case studies, events, and company information.

The chatbot uses published content from the Kagen WordPress website as its only
knowledge source. This reduces the risk of generating incorrect or unsupported
information.

## 2. Project Objectives

- Provide conversational support to Kagen website visitors
- Help users discover products, blogs, case studies, and events
- Provide reliable answers based on approved WordPress content
- Embed the chatbot as a widget on WordPress and other websites
- Display relevant content cards and official source links with answers

## 3. Technology Stack

| Area               | Technology                                    |
| ------------------ | --------------------------------------------- |
| Frontend           | Next.js 16, React, TypeScript                 |
| Backend            | Next.js API Routes                            |
| Styling            | Tailwind CSS and custom CSS                   |
| AI integration     | NVIDIA NIM through an OpenAI-compatible API   |
| AI model           | `meta/llama-3.1-8b-instruct`                  |
| Agent–UI protocol  | AG-UI over HTTP Server-Sent Events            |
| Content source     | WordPress REST API                            |
| Data validation    | Zod                                           |
| Markdown rendering | React Markdown and Remark GFM                 |
| Icons              | Lucide React                                  |
| Testing            | Vitest and jsdom                              |
| Code quality       | ESLint, Prettier, and TypeScript              |
| Deployment         | Vercel                                        |
| Search system      | Custom content indexing and relevance ranking |

The project does not currently require a vector database or a separate backend
server.

## 4. High-Level Architecture

```text
User
  ↓
Chat interface / Embedded widget
  ↓
AG-UI HttpAgent
  ↓
Next.js POST /api/ag-ui
  ↓
Grounded POST /api/chat workflow
  ↓
Request validation, CORS, and rate limiting
  ↓
WordPress content retrieval
  ↓
Content normalization and chunking
  ↓
Relevance-based search
  ↓
Top five matching content sections
  ↓
NVIDIA-hosted Llama model
  ↓
Validated answer, cards, and source links
  ↓
Chat interface
```

## 5. Project Structure

```text
kagenAiChatbot/
├── public/
│   ├── kagen-chat-widget.js
│   └── widget-test.html
│
├── src/
│   ├── app/
│   │   ├── api/chat/
│   │   ├── api/health/
│   │   ├── api/debug/retrieval/
│   │   ├── embed/
│   │   └── widget-preview/
│   │
│   ├── components/chat/
│   │
│   ├── lib/
│   │   ├── llm/
│   │   ├── kagen-api.ts
│   │   ├── search-index.ts
│   │   ├── search-retriever.ts
│   │   ├── intent-detector.ts
│   │   ├── acf-extractor.ts
│   │   ├── cors.ts
│   │   └── rate-limit.ts
│   │
│   └── types/
│
├── package.json
├── next.config.ts
├── vitest.config.ts
└── README.md
```

### Important Directories

- `src/app`: Application pages and API routes
- `src/components/chat`: Reusable React components for the chat interface
- `src/lib`: WordPress, search, AI, validation, and security logic
- `src/lib/llm`: AI provider abstraction and OpenAI-compatible integration
- `src/types`: Shared TypeScript interfaces
- `public`: Widget loader and static testing files

## 6. Main Features

- AI-powered conversational website assistant
- Answers grounded strictly in WordPress content
- Search across pages, posts, products, case studies, and events
- WordPress editor and recursive ACF content extraction
- Retrieval using keywords, partial phrases, and supported paraphrases
- Multilingual query preparation
- Relevant result cards and official source links
- Product, blog, contact, event, and case-study intent detection
- Embeddable widget for WordPress and external websites
- Widget color, position, size, logo, and welcome-message customization
- CORS protection, request validation, and rate limiting
- Safe fallback response when reliable information is unavailable

## 7. Content Retrieval Process

The search system fetches published WordPress content and indexes these fields:

- Page or post title
- Excerpt
- Complete rendered content
- Recursive ACF fields
- Nested objects and arrays
- FAQs, tabs, and rich-text sections
- Relevant headings, descriptions, and URLs

The content is divided into paragraph-preserving chunks and ranked by relevance.
Context from the five most relevant results is provided to the AI model.

## 8. API Endpoints

| Endpoint                    | Purpose                                                |
| --------------------------- | ------------------------------------------------------ |
| `POST /api/ag-ui`           | AG-UI event-stream endpoint used by the chat interface |
| `POST /api/chat`            | Main chatbot request endpoint                          |
| `GET /api/health`           | Application health check                               |
| `POST /api/debug/retrieval` | Search and retrieval debugging                         |
| `/embed`                    | Embeddable chatbot interface                           |
| `/widget-preview`           | Widget configuration and preview                       |

## 9. Security

- The AI API key is used only on the server
- Requests and responses are validated with Zod
- Allowed origins provide CORS protection
- IP-based rate limiting is implemented
- External widget URLs are validated
- Generic AI answers are not generated for unsupported information
- API secrets are not exposed through `NEXT_PUBLIC_*` variables

## 10. Environment Configuration

Main environment variables:

```env
NEXT_PUBLIC_APP_NAME=Kagen AI Assistant

KAGEN_API_BASE_URL=http://localhost/wp-kagen/wp-json/kagen/v1
KAGEN_PUBLIC_SITE_URL=http://localhost/wp-kagen

AI_PROVIDER=nvidia
AI_MODEL=meta/llama-3.1-8b-instruct
AI_BASE_URL=https://integrate.api.nvidia.com/v1
AI_API_KEY=replace-with-server-side-secret

ALLOWED_ORIGINS=http://localhost:3000,https://kagen.ai
WIDGET_ALLOWED_ORIGINS=http://localhost:3000,https://kagen.ai
NEXT_PUBLIC_CHAT_API_URL=/api/chat
NEXT_PUBLIC_AG_UI_API_URL=/api/ag-ui
```

Real API keys must never be committed to the repository.

## 11. Local Setup

Requirements:

- Current Node.js LTS
- npm
- Access to the Kagen WordPress REST API
- A valid NVIDIA or OpenAI-compatible API key

Commands:

```bash
npm install
npm run dev
```

Local URLs:

- Application: `http://localhost:3000`
- Widget preview: `http://localhost:3000/widget-preview`
- Static widget test: `http://localhost:3000/widget-test.html`
- Health check: `http://localhost:3000/api/health`

## 12. Testing and Quality Checks

```bash
npm run format
npm test -- --run
npm run lint
npm run typecheck
npm run build
```

According to the project documentation, on 24 July 2026:

- 38 automated tests passed
- ESLint checks passed
- TypeScript checks passed
- The production build passed

## 13. Deployment

Production application:

`https://kagen-ai-chatbot.vercel.app`

The application is deployed on Vercel. The production environment requires a
publicly accessible WordPress REST API endpoint.

## 14. Current Project Status

Last documented verification: **24 July 2026**

- The Next.js application is implemented
- The chat interface and embeddable widget are available
- WordPress-based search and retrieval are implemented
- NVIDIA NIM AI integration is implemented
- The health endpoint and widget deployment are accessible
- The local WordPress inventory contained 72 documented published objects

### Current Production Blocker

The live WordPress endpoint:

```text
https://kagen.ai/wp-json/kagen/v1/content
```

returns `404` according to the project documentation. The custom `kagen/v1`
REST API route must be activated or deployed on the live WordPress website.

Until the endpoint becomes available, the production chatbot will return a
`CONTENT_UNAVAILABLE` response.

## 15. Next Steps

1. Activate the `kagen/v1` REST API route on the live WordPress website
2. Verify the production endpoint response
3. Verify the Vercel environment variables
4. Run an end-to-end production chatbot test
5. Integrate and validate the widget on the Kagen website

## 16. Short Shareable Description

Kagen AI Chatbot is a production-oriented AI website assistant developed with
Next.js, React, and TypeScript. It uses the Llama 3.1 8B Instruct model through
NVIDIA NIM and retrieves approved content from the Kagen WordPress REST API.
The solution includes custom full-content retrieval, grounded AI responses,
result cards, source links, multilingual query support, security controls, and
an embeddable website widget. The application is deployed on Vercel, but the
custom live WordPress REST endpoint must be activated before the production
chatbot becomes fully operational.
