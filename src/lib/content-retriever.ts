import { normalizeContent } from "./content-normalizer";
import { detectIntent } from "./intent-detector";
import { fetchKagen } from "./kagen-api";
import { rankContent } from "./relevance-score";
import type { NormalizedContent } from "@/types/wordpress";

export async function retrieveContent(query: string): Promise<{
  intent: ReturnType<typeof detectIntent>;
  items: NormalizedContent[];
}> {
  const intent = detectIntent(query);
  let paths: string[];
  let max = 8;
  switch (intent) {
    case "products":
    case "product_detail":
      paths = [
        "/content?type=product&per_page=100",
        "/pages/products",
        "/pages/kagen-prism-ai-first-content-intelligence-platform",
        "/pages/cognitive-document-intelligence-enterprise-automation-guide",
      ];
      max = 6;
      break;
    case "case_studies":
      paths = ["/content?type=case-studies&per_page=100"];
      max = 6;
      break;
    case "blogs":
      paths = ["/content?type=post&per_page=100"];
      max = 6;
      break;
    case "resources":
      paths = ["/content?type=post&per_page=100", "/pages/resources"];
      max = 6;
      break;
    case "events":
      paths = ["/content?type=event&per_page=100"];
      max = 4;
      break;
    case "contact":
      paths = ["/pages/contact-us"];
      break;
    case "about":
      paths = ["/pages/about-us"];
      break;
    case "page":
      paths = [
        `/content?type=page&search=${encodeURIComponent(query)}&per_page=20`,
      ];
      break;
    default:
      paths = [
        `/content?type=all&search=${encodeURIComponent(query)}&per_page=20`,
      ];
  }
  const settled = await Promise.allSettled(paths.map(fetchKagen));
  let raw = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  if (!raw.length && intent === "general") {
    const fallback = await Promise.allSettled(
      [
        "/pages/products",
        "/pages/about-us",
        "/pages/resources",
        "/pages/contact-us",
      ].map(fetchKagen),
    );
    raw = fallback.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
  }
  if (!raw.length) {
    const error = settled.find((result) => result.status === "rejected");
    if (error?.status === "rejected") throw error.reason;
  }
  const unique = [
    ...new Map(raw.map((item) => [item.id || item.link, item])).values(),
  ];
  return {
    intent,
    items: rankContent(unique.map(normalizeContent), query, intent, max),
  };
}
