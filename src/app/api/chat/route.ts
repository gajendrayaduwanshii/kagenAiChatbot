import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { corsHeaders } from "@/lib/cors";
import { greetingResponse, isGreeting } from "@/lib/conversation";
import { detectIntent } from "@/lib/intent-detector";
import { getEnv } from "@/lib/env";
import { fetchKagen } from "@/lib/kagen-api";
import { getLLMProvider } from "@/lib/llm";
import { assistantResponseSchema } from "@/lib/llm/schemas";
import { rateLimit } from "@/lib/rate-limit";
import {
  canUseEnglishQueryDirectly,
  prepareEnglishQuery,
} from "@/lib/query-language";
import { buildSearchDocument } from "@/lib/search-index";
import { retrieveFromIndex } from "@/lib/search-retriever";
import type { NormalizedContent } from "@/types/wordpress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const requestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(2, "Please enter at least 2 characters.")
    .max(1000, "Please keep your message under 1,000 characters."),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      }),
    )
    .max(10)
    .optional()
    .default([]),
  sessionId: z.string().max(100).optional(),
});
const error = (
  status: number,
  code: string,
  message: string,
  headers: Record<string, string>,
) =>
  NextResponse.json(
    { success: false, error: { code, message } },
    { status, headers },
  );

export async function OPTIONS(request: NextRequest) {
  const cors = corsHeaders(request.headers.get("origin"));
  if (!cors.isAllowed)
    return error(
      403,
      "ORIGIN_NOT_ALLOWED",
      "This origin is not allowed.",
      cors.headers,
    );
  return new NextResponse(null, { status: 204, headers: cors.headers });
}
export async function POST(request: NextRequest) {
  const cors = corsHeaders(request.headers.get("origin"));
  if (!cors.isAllowed)
    return error(
      403,
      "ORIGIN_NOT_ALLOWED",
      "This origin is not allowed.",
      cors.headers,
    );
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const limit = rateLimit(ip);
  if (!limit.allowed)
    return error(
      429,
      "RATE_LIMITED",
      "Too many messages. Please wait a moment and try again.",
      { ...cors.headers, "Retry-After": String(limit.retryAfter) },
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(
      400,
      "INVALID_REQUEST",
      "Please send a valid JSON request.",
      cors.headers,
    );
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success)
    return error(
      400,
      "INVALID_REQUEST",
      parsed.error.issues[0]?.message ?? "Invalid request.",
      cors.headers,
    );
  if (isGreeting(parsed.data.message)) {
    return NextResponse.json(
      { success: true, data: greetingResponse() },
      { headers: { ...cors.headers, "Cache-Control": "no-store" } },
    );
  }
  let preparedQuery;
  if (canUseEnglishQueryDirectly(parsed.data.message)) {
    preparedQuery = prepareEnglishQuery(parsed.data.message);
  } else {
    try {
      preparedQuery = await getLLMProvider().prepareMultilingualQuery(
        parsed.data.message,
      );
    } catch {
      if (!getEnv().AI_API_KEY) {
        return error(
          503,
          "AI_NOT_CONFIGURED",
          "The AI provider is not configured. Add AI_API_KEY to the server environment and restart the application.",
          cors.headers,
        );
      }
      return error(
        503,
        "AI_TRANSLATION_UNAVAILABLE",
        "The query language could not be processed safely. Please try again.",
        cors.headers,
      );
    }
  }
  const effectiveMessage = preparedQuery.englishQuery;
  const intent = detectIntent(effectiveMessage);
  // Contact is a deterministic navigation intent. Fetch only the published
  // Contact Us page and return one API-backed card; never run broad retrieval
  // that can mix in unrelated posts, case studies, or privacy content.
  if (intent === "contact") {
    try {
      const item = (await fetchKagen("/pages/contact-us"))[0];
      if (!item) throw new Error("Contact page is unavailable");
      const document = buildSearchDocument(item);
      const description =
        document.textSegments.find(
          (segment) => segment.toLowerCase() !== document.title.toLowerCase(),
        ) ?? "Open the official Kagen Contact Us page.";
      return NextResponse.json(
        {
          success: true,
          data: {
            answer: preparedQuery.contactAnswer,
            cards: [
              {
                type: "page",
                title: document.title,
                description,
                url: document.url,
                image: document.image,
                badge: "page",
              },
            ],
            sources: [],
            suggestions: [],
            confidence: "high",
            insufficientContext: false,
          },
        },
        { headers: { ...cors.headers, "Cache-Control": "no-store" } },
      );
    } catch {
      return error(
        503,
        "CONTENT_UNAVAILABLE",
        "Kagen’s contact page is temporarily unavailable.",
        cors.headers,
      );
    }
  }
  // A request for blogs means the published collection, not a keyword search
  // for the word "blog". This also handles conversational multilingual queries
  // asking for information about the published blog collection.
  if (intent === "blogs") {
    try {
      const posts = (await fetchKagen("/content?type=post&per_page=100"))
        .map(buildSearchDocument)
        .sort(
          (a, b) => Date.parse(b.modified ?? "") - Date.parse(a.modified ?? ""),
        )
        .slice(0, 5);
      if (!posts.length) throw new Error("Blog collection is unavailable");
      return NextResponse.json(
        {
          success: true,
          data: {
            answer: preparedQuery.blogsAnswer,
            cards: posts.map((document) => ({
              type: "blog",
              title: document.title,
              description: (
                document.descriptions[0] ??
                document.textSegments[0] ??
                document.title
              ).slice(0, 500),
              url: document.url,
              image: document.image,
              badge: "blog",
            })),
            sources: posts.map((document) => ({
              title: document.title,
              url: document.url,
            })),
            suggestions: [],
            confidence: "high",
            insufficientContext: false,
          },
        },
        { headers: { ...cors.headers, "Cache-Control": "no-store" } },
      );
    } catch {
      return error(
        503,
        "CONTENT_UNAVAILABLE",
        "Kagen’s blog collection is temporarily unavailable.",
        cors.headers,
      );
    }
  }
  try {
    const retrieval = await retrieveFromIndex(effectiveMessage);
    if (!retrieval.reliableMatchFound) {
      return NextResponse.json(
        {
          success: true,
          data: {
            answer: preparedQuery.fallbackAnswer,
            cards: [],
            sources: [],
            suggestions: [],
            confidence: "low",
            insufficientContext: true,
          },
        },
        { headers: { ...cors.headers, "Cache-Control": "no-store" } },
      );
    }
    const topScore = retrieval.matches[0]?.score ?? 0;
    // Retrieval already returns the globally ranked Top 5. Do not narrow that
    // set again here: every selected chunk must reach the grounded LLM prompt.
    const selectedMatches = retrieval.matches;
    const context: NormalizedContent[] = selectedMatches.map(
      ({ document, selectedPassages }) => ({
        id: document.id,
        type: document.type,
        slug: document.slug,
        title: document.title,
        excerpt: document.descriptions[0] ?? selectedPassages[0] ?? "",
        plainText: selectedPassages.join("\n\n"),
        url: document.url,
        image: document.image,
        modified: document.modified,
        acfText: "",
        extractedUrls: [],
      }),
    );
    let response;
    if (!getEnv().AI_API_KEY) {
      return error(
        503,
        "AI_NOT_CONFIGURED",
        "The AI provider is not configured. Add AI_API_KEY to the server environment and restart the application.",
        cors.headers,
      );
    }
    try {
      response = await getLLMProvider().generateStructuredResponse({
        message: effectiveMessage,
        responseLanguage: preparedQuery.responseLanguage,
        fallbackAnswer: preparedQuery.fallbackAnswer,
        history: parsed.data.history.slice(-10),
        context,
      });
    } catch {
      return error(
        503,
        "AI_RESPONSE_UNAVAILABLE",
        "A verified answer could not be generated from the published Kagen content. Please try again.",
        cors.headers,
      );
    }
    const validated = assistantResponseSchema.safeParse(response);
    if (!validated.success) {
      return error(
        503,
        "INVALID_AI_RESPONSE",
        "The generated answer could not be safely validated. Please try again.",
        cors.headers,
      );
    }
    response = {
      ...validated.data,
      cards: selectedMatches.map(({ document, selectedPassages }) => ({
        type: cardType(document.type),
        title: document.title,
        description:
          document.descriptions[0] ?? selectedPassages[0] ?? document.title,
        url: document.url,
        image: document.image,
        badge: document.type,
      })),
      sources: selectedMatches.map(({ document }) => ({
        title: document.title,
        url: document.url,
      })),
      confidence: topScore >= 100 ? "high" : "medium",
      insufficientContext: false,
    };
    return NextResponse.json(
      { success: true, data: response },
      { headers: { ...cors.headers, "Cache-Control": "no-store" } },
    );
  } catch {
    return error(
      503,
      "CONTENT_UNAVAILABLE",
      "Kagen’s content service is temporarily unavailable. Please try again shortly.",
      cors.headers,
    );
  }
}

function cardType(
  type: string,
): "product" | "case-study" | "blog" | "event" | "page" {
  if (type === "product") return "product";
  if (type.includes("case")) return "case-study";
  if (type === "post") return "blog";
  if (type === "event") return "event";
  return "page";
}
