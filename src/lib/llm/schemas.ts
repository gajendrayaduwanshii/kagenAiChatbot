import { z } from "zod";

export const cardSchema = z.object({
  type: z.enum(["product", "case-study", "blog", "event", "page"]),
  title: z.string().min(1).max(200),
  description: z.string().max(500),
  url: z.string().url(),
  image: z.string().url().optional(),
  badge: z.string().max(50).optional(),
  date: z.string().max(50).optional(),
});
export const assistantResponseSchema = z.object({
  answer: z.string().min(1).max(8000),
  cards: z.array(cardSchema).max(6).default([]),
  suggestions: z.array(z.string().min(2).max(160)).max(4).default([]),
  sources: z
    .array(
      z.object({ title: z.string().min(1).max(200), url: z.string().url() }),
    )
    .max(6)
    .default([]),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  insufficientContext: z.boolean().optional(),
});
export type AssistantResponse = z.infer<typeof assistantResponseSchema>;

export function filterResponseUrls(
  response: AssistantResponse,
  allowed: Set<string>,
): AssistantResponse {
  const canonical = (url: string) => {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname.replace(/\/$/, "")}${u.search}`;
    } catch {
      return "";
    }
  };
  const valid = new Set([...allowed].map(canonical));
  return {
    ...response,
    cards: response.cards
      .filter((card) => valid.has(canonical(card.url)))
      .map((card) => ({
        ...card,
        image:
          card.image && valid.has(canonical(card.image))
            ? card.image
            : undefined,
      })),
    sources: response.sources.filter((source) =>
      valid.has(canonical(source.url)),
    ),
  };
}
