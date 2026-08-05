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
  if (/\bproducts?\b/i.test(effectiveMessage)) {
    try {
      const [listingItems, productItems] = await Promise.all([
        fetchKagen("/pages/products"),
        fetchKagen("/content?type=product&per_page=100"),
      ]);
      const listing = listingItems[0]
        ? buildSearchDocument(listingItems[0])
        : undefined;
      const products = productItems
        .filter((item) => item.type === "product")
        .map(buildSearchDocument)
        .sort(
          (a, b) => Date.parse(b.modified ?? "") - Date.parse(a.modified ?? ""),
        )
        .slice(0, 5);
      if (!listing || !products.length) {
        throw new Error("Product collection is unavailable");
      }
      const documents = [listing, ...products];
      return NextResponse.json(
        {
          success: true,
          data: {
            answer: buildCollectionStory(
              "products",
              { title: listing.title, url: listing.url },
              products,
            ),
            cards: documents.map((document, index) => ({
              type: index === 0 ? "page" : "product",
              title: document.title,
              description: (
                document.descriptions[0] ??
                document.textSegments[0] ??
                document.title
              ).slice(0, 500),
              url: document.url,
              image: document.image,
              badge: index === 0 ? "products" : "product",
            })),
            sources: documents.map((document) => ({
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
        "Kagen’s product collection is temporarily unavailable.",
        cors.headers,
      );
    }
  }
  // Case-study collection requests must never fall through to keyword-based
  // global retrieval, where blog posts mentioning "case studies" can outrank
  // the actual collection. Return the listing page followed by the five most
  // recently modified published case studies.
  if (
    intent === "case_studies" &&
    /\bcase\s+stud(?:y|ies)\b/i.test(effectiveMessage)
  ) {
    try {
      const [listingItems, caseStudyItems] = await Promise.all([
        fetchKagen("/pages/case-studies"),
        fetchKagen("/content?type=case-studies&per_page=100"),
      ]);
      const listing = listingItems[0]
        ? buildSearchDocument(listingItems[0])
        : undefined;
      const caseStudies = caseStudyItems
        .filter((item) => item.type?.includes("case"))
        .map(buildSearchDocument)
        .sort(
          (a, b) => Date.parse(b.modified ?? "") - Date.parse(a.modified ?? ""),
        )
        .slice(0, 5);
      if (!listing || !caseStudies.length) {
        throw new Error("Case-study collection is unavailable");
      }
      const documents = [listing, ...caseStudies];
      return NextResponse.json(
        {
          success: true,
          data: {
            answer: buildCollectionStory(
              "case studies",
              { title: listing.title, url: listing.url },
              caseStudies,
            ),
            cards: documents.map((document, index) => ({
              type: index === 0 ? "page" : "case-study",
              title: document.title,
              description: (
                document.descriptions[0] ??
                document.textSegments[0] ??
                document.title
              ).slice(0, 500),
              url: document.url,
              image: document.image,
              badge: index === 0 ? "case studies" : "case study",
            })),
            sources: documents.map((document) => ({
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
        "Kagen’s case-study collection is temporarily unavailable.",
        cors.headers,
      );
    }
  }
  // A request for blogs means the published collection, not a keyword search
  // for the word "blog". This also handles conversational multilingual queries
  // asking for information about the published blog collection.
  if (intent === "blogs" && /\bblogs?\b/i.test(effectiveMessage)) {
    try {
      const [listingItems, postItems] = await Promise.all([
        fetchKagen("/pages/blog").catch(() => []),
        fetchKagen("/content?type=post&per_page=100"),
      ]);
      const listing = listingItems[0]
        ? buildSearchDocument(listingItems[0])
        : undefined;
      const posts = postItems
        .filter((item) => item.type === "post")
        .map(buildSearchDocument)
        .sort(
          (a, b) => Date.parse(b.modified ?? "") - Date.parse(a.modified ?? ""),
        )
        .slice(0, 5);
      if (!posts.length) throw new Error("Blog collection is unavailable");
      const listingCard = listing
        ? {
            type: "page" as const,
            title: listing.title,
            description: (
              listing.descriptions[0] ??
              listing.textSegments[0] ??
              listing.title
            ).slice(0, 500),
            url: listing.url,
            image: listing.image,
            badge: "blogs",
          }
        : {
            type: "page" as const,
            title: "Blogs",
            description: "Explore Kagen's published blog articles.",
            url: `${getEnv().KAGEN_PUBLIC_SITE_URL.replace(/\/$/, "")}/blog/`,
            badge: "blogs",
          };
      return NextResponse.json(
        {
          success: true,
          data: {
            answer: buildCollectionStory(
              "blogs",
              { title: listingCard.title, url: listingCard.url },
              posts,
            ),
            cards: [listingCard, ...posts.map((document) => ({
              type: "blog" as const,
              title: document.title,
              description: (
                document.descriptions[0] ??
                document.textSegments[0] ??
                document.title
              ).slice(0, 500),
              url: document.url,
              image: document.image,
              badge: "blog",
            }))],
            sources: [
              { title: listingCard.title, url: listingCard.url },
              ...posts.map((document) => ({
              title: document.title,
              url: document.url,
              })),
            ],
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

function buildCollectionStory(
  label: string,
  listing: { title: string; url: string },
  items: Array<{
    title: string;
    url: string;
    descriptions: string[];
    textSegments: string[];
  }>,
): string {
  const entries = items.map((item) => {
    const description = cleanStoryDescription(
      item.descriptions[0] ??
      item.textSegments[0] ??
      "Open the corresponding published Kagen page for more information.",
    );
    const ending = /[.!?…]$/.test(description) ? "" : ".";
    return `[${item.title.replace(/[\[\]]/g, "")}](${item.url}) focuses on ${description.charAt(0).toLowerCase()}${description.slice(1)}${ending}`;
  });
  const heading = label
    .split(" ")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
  return `**Kagen ${heading}**\n\nKagen brings its published ${label} together to show how its capabilities, ideas, and real-world work address enterprise needs.\n\n**What You Can Explore**\n\n${entries.join(" ")}\n\n**How It Comes Together**\n\nTogether, these examples provide a connected view of Kagen’s approach rather than a simple catalogue. You can use the **${listing.title.replace(/[\[\]]/g, "")}** source below to continue exploring the full collection.`;
}

function cleanStoryDescription(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= 240) return clean;
  const shortened = clean.slice(0, 240);
  const sentenceEnd = Math.max(
    shortened.lastIndexOf(". "),
    shortened.lastIndexOf("! "),
    shortened.lastIndexOf("? "),
  );
  if (sentenceEnd >= 100) return shortened.slice(0, sentenceEnd + 1);
  const lastWord = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, lastWord > 0 ? lastWord : 240)}…`;
}
