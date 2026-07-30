export type Intent =
  | "greeting"
  | "help"
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
  const greeting = q.replace(/[!,.?।]+$/g, "").trim();
  if (
    /^(hi|hello|hey|namaste|namaskar|हाय|नमस्ते|नमस्कार)( (there|kagen|kagen ai))?$/.test(
      greeting,
    )
  )
    return "greeting";
  const helpRequest = greeting
    .replace(/^(hi|hello|hey|namaste|namaskar|हाय|नमस्ते|नमस्कार)[,\s]+/, "")
    .replace(/\b(please|pls|plz)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^(help|help me|i (need|heed|nead|want) help|can you help me|could you help me|mujhe (help|madad) (chahiye|chaiye)|meri (help|madad) karo|मुझे मदद चाहिए|मेरी मदद करो)$/.test(
      helpRequest,
    )
  )
    return "help";
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
      "ai voice",
      "voice agent",
      "voice automation",
      "kagen voice",
      "kagen add",
      "agentic-driven delivery",
      "agentic driven delivery",
      "adaptive compatibility",
    ])
  )
    return "product_detail";
  if (
    includes(q, [
      "company",
      "who is kagen",
      "kagen ai",
      "kagen eye",
      "kaga ai",
      "kaga eye",
    ]) ||
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
