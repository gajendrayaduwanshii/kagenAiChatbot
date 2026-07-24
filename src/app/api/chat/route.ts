import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { corsHeaders } from "@/lib/cors";
import { retrieveContent } from "@/lib/content-retriever";
import { fallbackResponse } from "@/lib/fallback-response";
import { getLLMProvider } from "@/lib/llm";
import { assistantResponseSchema, filterResponseUrls } from "@/lib/llm/schemas";
import { rateLimit } from "@/lib/rate-limit";

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
  try {
    const retrieved = await retrieveContent(parsed.data.message);
    const fallback = fallbackResponse(
      retrieved.items,
      retrieved.intent,
      parsed.data.message,
    );
    let response = fallback;
    const deterministicComparison =
      (retrieved.intent === "products" ||
        retrieved.intent === "product_detail") &&
      /\b(compare|comparison|difference|versus|vs\.?)\b/i.test(
        parsed.data.message,
      );
    if (!deterministicComparison) {
      try {
        response = await getLLMProvider().generateStructuredResponse({
          message: parsed.data.message,
          history: parsed.data.history.slice(-10),
          context: retrieved.items,
        });
        const allowed = new Set(
          retrieved.items.flatMap((x) =>
            [x.url, x.image, ...x.extractedUrls].filter((v): v is string =>
              Boolean(v),
            ),
          ),
        );
        response = filterResponseUrls(
          assistantResponseSchema.parse(response),
          allowed,
        );
        if (!response.cards.length && fallback.cards.length)
          response.cards = fallback.cards;
        if (!response.sources.length) response.sources = fallback.sources;
      } catch {
        response = fallback;
      }
    }
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
