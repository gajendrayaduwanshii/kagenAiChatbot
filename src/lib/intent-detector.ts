export type Intent =
  | "products"
  | "product_detail"
  | "case_studies"
  | "blogs"
  | "events"
  | "resources"
  | "contact"
  | "about"
  | "page"
  | "general";
const includes = (text: string, terms: string[]) =>
  terms.some((term) => text.includes(term));

export function detectIntent(query: string): Intent {
  const q = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (
    includes(q, [
      "case study",
      "case studies",
      "customer story",
      "customer stories",
      "success story",
      "success stories",
    ])
  )
    return "case_studies";
  if (includes(q, ["event", "events", "webinar", "webinars"])) return "events";
  if (
    includes(q, ["contact", "email", "talk to", "book a demo", "reach kagen"])
  )
    return "contact";
  if (
    includes(q, [
      "prism",
      "cognitive document intelligence",
      "document intelligence",
    ])
  )
    return "product_detail";
  if (
    includes(q, ["company", "who is kagen"]) ||
    /\babout (kagen|the company)\b/.test(q)
  )
    return "about";
  if (includes(q, ["product", "products", "solution", "solutions", "platform"]))
    return "products";
  if (includes(q, ["resource", "resources"])) return "resources";
  if (includes(q, ["blog", "article", "articles", "insight", "insights"]))
    return "blogs";
  if (includes(q, ["page", "privacy", "sitemap"])) return "page";
  return "general";
}
