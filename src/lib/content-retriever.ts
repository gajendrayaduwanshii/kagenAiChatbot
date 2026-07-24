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
      paths = ["/content?type=product&per_page=100", "/pages/products"];
      max = 6;
      break;
    case "product_detail":
      if (query.toLowerCase().includes("prism")) {
        paths = [
          "/pages/kagen-prism-ai-first-content-intelligence-platform",
          "/pages/products",
        ];
      } else if (
        query.toLowerCase().includes("cognitive document") ||
        query.toLowerCase().includes("document intelligence")
      ) {
        paths = [
          "/pages/cognitive-document-intelligence-enterprise-automation-guide",
          "/pages/products",
        ];
      } else {
        // Product names can change as WordPress content evolves. Fetch the
        // published product collection and let local relevance ranking select
        // only the matching detail item instead of hardcoding a product URL.
        paths = ["/content?type=product&per_page=100", "/pages/products"];
      }
      max = 2;
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
      // The standalone About page is disabled. The Home page contains the
      // published, canonical About Kagen section for company questions.
      paths = ["/pages/home"];
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
  const raw = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  if (!raw.length) {
    const error = settled.find((result) => result.status === "rejected");
    if (error?.status === "rejected") throw error.reason;
  }
  const unique = [
    ...new Map(raw.map((item) => [item.id || item.link, item])).values(),
  ];
  const normalized = unique.map(normalizeContent);
  const usesProductCollection =
    intent === "product_detail" &&
    paths.some((path) => path.includes("type=product"));
  if (usesProductCollection) {
    const matchingProduct = rankContent(
      normalized.filter((item) => item.type === "product"),
      query,
      intent,
      1,
    );
    const productsPage = normalized.find(
      (item) => item.type === "page" && item.slug === "products",
    );
    return {
      intent,
      items: [
        ...matchingProduct,
        ...(productsPage ? [productsPage] : []),
      ].slice(0, 2),
    };
  }
  return {
    intent,
    items: rankContent(normalized, query, intent, max),
  };
}
