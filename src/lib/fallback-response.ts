import type { Intent } from "./intent-detector";
import type { AssistantResponse } from "./llm/schemas";
import type { NormalizedContent } from "@/types/wordpress";

const cardType = (
  type: string,
): "product" | "case-study" | "blog" | "event" | "page" => {
  if (type === "product") return "product";
  if (type.includes("case")) return "case-study";
  if (type === "post") return "blog";
  if (type === "event") return "event";
  return "page";
};
export function fallbackResponse(
  items: NormalizedContent[],
  intent: Intent,
  query = "",
): AssistantResponse {
  if (!items.length)
    return {
      answer:
        "I couldn’t find relevant information in the available Kagen website content. Please try a more specific question.",
      cards: [],
      suggestions: [
        "What products does Kagen offer?",
        "How can I contact Kagen?",
      ],
      sources: [],
    };
  const productIntent = intent === "products" || intent === "product_detail";
  const productItems = items.filter((item) => item.type === "product");
  const isComparison =
    productIntent &&
    /\b(compare|comparison|difference|versus|vs\.?)\b/i.test(query);

  if (isComparison && productItems.length > 1) {
    const compared = productItems.slice(0, 6);
    return {
      answer: [
        "Here’s a comparison of the Kagen products available in the website content:",
        "",
        "| Product | Overview |",
        "| --- | --- |",
        ...compared.map(
          (item) =>
            `| [${escapeMarkdownTable(item.title)}](${item.url}) | ${escapeMarkdownTable(item.excerpt || item.plainText.slice(0, 260) || "No additional overview is available.")} |`,
        ),
        "",
        "The published content does not provide standardized pricing or a feature-by-feature specification matrix, so this comparison is limited to the official product descriptions.",
      ].join("\n"),
      cards: compared
        .filter((item) => item.url)
        .map((item) => ({
          type: "product" as const,
          title: item.title,
          description: item.excerpt || item.plainText.slice(0, 220),
          url: item.url,
          image: item.image,
          badge: "product",
          date: item.modified,
        })),
      suggestions: [
        "Explain Kagen PRISM",
        "Which Kagen product fits document automation?",
        "Show related case studies",
        "How can I request a demo?",
      ],
      sources: compared
        .filter((item) => item.url)
        .map((item) => ({ title: item.title, url: item.url })),
    };
  }

  const label = productIntent
    ? "product information"
    : intent.replace("_", " ");
  const displayItems =
    productIntent && productItems.length ? productItems : items;
  return {
    answer: `Here’s the most relevant Kagen ${label} I found:\n\n${displayItems
      .slice(0, 6)
      .map((x) => `- **${x.title}**${x.excerpt ? ` — ${x.excerpt}` : ""}`)
      .join("\n")}`,
    cards: displayItems
      .filter((x) => x.url)
      .slice(0, 6)
      .map((x) => ({
        type: cardType(x.type),
        title: x.title,
        description: x.excerpt || x.plainText.slice(0, 220),
        url: x.url,
        image: x.image,
        badge: cardType(x.type).replace("-", " "),
        date: x.modified,
      })),
    suggestions: productIntent
      ? [
          "Compare these products",
          "Explain Kagen PRISM",
          "Show related case studies",
          "How can I request a demo?",
        ]
      : [
          "Tell me more about Kagen products",
          "Show me case studies",
          "How can I contact Kagen?",
        ],
    sources: displayItems
      .filter((x) => x.url)
      .slice(0, 6)
      .map((x) => ({ title: x.title, url: x.url })),
  };
}

function escapeMarkdownTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}
