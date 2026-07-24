import { afterEach, describe, expect, it, vi } from "vitest";
import { detectIntent } from "./intent-detector";
import { htmlToText } from "./html-utils";
import { flattenAcf, normalizeContent } from "./content-normalizer";
import { relevanceScore } from "./relevance-score";
import { assistantResponseSchema, filterResponseUrls } from "./llm/schemas";
import { retrieveContent } from "./content-retriever";
import {
  buildContentDetail,
  buildProductComparison,
} from "./api-response-builder";
import { corsHeaders } from "./cors";
import {
  hexColorSchema,
  httpUrlSchema,
  parseWidgetQuery,
  readableForeground,
  widgetMessageSchema,
} from "./widget-config";
import { readFileSync } from "node:fs";
import {
  cleanText,
  deduplicateSegments,
  extractAcfContent,
} from "./acf-extractor";
import {
  buildSearchDocument,
  buildSearchChunks,
  normalizeWordPressUrl,
} from "./search-index";
import {
  normalizeQuery,
  rankSearchDocument,
  retrieveFromIndex,
} from "./search-retriever";
import { fetchAllPublishedContent } from "./kagen-api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("intent detection", () => {
  it("detects specific intents before broad product terms", () => {
    expect(detectIntent("Tell me about Kagen PRISM platform")).toBe(
      "product_detail",
    );
    expect(detectIntent("do you know about kaga eye")).toBe("about");
    expect(detectIntent("Show customer stories")).toBe("case_studies");
    expect(detectIntent("Book a demo")).toBe("contact");
  });
});
describe("HTML utilities", () => {
  it("removes unsafe markup and decodes entities", () => {
    expect(
      htmlToText("<p>Hello &amp; welcome</p><script>alert(1)</script>"),
    ).toBe("Hello & welcome");
  });
});
describe("ACF normalization", () => {
  it("recursively extracts text, links, and images", () => {
    const result = flattenAcf({
      group: [
        { body: "<b>Useful</b>" },
        { hero_image: "https://kagen.ai/a.jpg" },
      ],
    });
    expect(result.text).toContain("Useful");
    expect(result.images).toContain("https://kagen.ai/a.jpg");
  });
  it("normalizes WordPress items safely", () => {
    const result = normalizeContent({
      id: 1,
      type: "product",
      link: "https://kagen.ai/p",
      title: { rendered: "PRISM" },
      content: { rendered: "<p>Content</p>" },
    });
    expect(result).toMatchObject({
      title: "PRISM",
      plainText: "PRISM\nContent",
      url: "https://kagen.ai/p",
    });
  });
  it("uses a meaningful ACF hero description when excerpt is empty", () => {
    const result = normalizeContent({
      id: 2,
      type: "product",
      link: "https://kagen.ai/voice",
      title: { rendered: "Kagen VOICE" },
      excerpt: { rendered: "" },
      acf: {
        image: {
          filename: "voice-screenshot.png",
          url: "https://kagen.ai/voice.png",
        },
        hero_description:
          "Deploy enterprise AI voice agents for secure and natural call automation.",
      },
    });
    expect(result.excerpt).toBe(
      "Deploy enterprise AI voice agents for secure and natural call automation.",
    );
  });
  it("uses a broad Home product heading instead of product-specific metadata", () => {
    const result = normalizeContent({
      id: 3,
      type: "page",
      slug: "home",
      link: "https://kagen.ai/",
      title: { rendered: "Home" },
      acf: {
        home_hero_description: "A product-specific description.",
        home_products_heading:
          "AI-Native Suite Built to Automate, Govern, and Scale",
      },
    });
    expect(result.excerpt).toBe(
      "AI-Native Suite Built to Automate, Govern, and Scale",
    );
  });
});
describe("relevance scoring", () => {
  it("weights title and matching type", () => {
    const base = {
      id: 1,
      type: "product",
      slug: "",
      title: "Kagen PRISM",
      excerpt: "",
      plainText: "platform",
      url: "",
      acfText: "",
      extractedUrls: [],
    };
    expect(relevanceScore(base, "Kagen PRISM", "products")).toBeGreaterThan(
      relevanceScore({ ...base, title: "Other" }, "Kagen PRISM", "general"),
    );
  });
});
describe("structured responses", () => {
  it("validates bounds and filters invented URLs", () => {
    const valid = assistantResponseSchema.parse({
      answer: "Answer",
      cards: [
        {
          type: "product",
          title: "Good",
          description: "",
          url: "https://kagen.ai/good",
        },
        {
          type: "page",
          title: "Bad",
          description: "",
          url: "https://evil.test/",
        },
      ],
      suggestions: [],
      sources: [{ title: "Good", url: "https://kagen.ai/good" }],
    });
    const filtered = filterResponseUrls(
      valid,
      new Set(["https://kagen.ai/good"]),
    );
    expect(filtered.cards).toHaveLength(1);
    expect(filtered.sources).toHaveLength(1);
  });
});
describe("WordPress retrieval", () => {
  it("fetches product data dynamically and ranks matching products", async () => {
    const products = [
      {
        id: 10,
        type: "product",
        slug: "prism",
        link: "https://kagen.ai/prism",
        title: { rendered: "Kagen PRISM" },
        excerpt: { rendered: "Content intelligence platform" },
      },
      {
        id: 11,
        type: "product",
        slug: "new-product",
        link: "https://kagen.ai/new",
        title: { rendered: "New Dynamic Product" },
        excerpt: { rendered: "A newly published product" },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            url.includes("type=product")
              ? JSON.stringify(products)
              : JSON.stringify({
                  id: 20,
                  type: "page",
                  link: "https://kagen.ai/products",
                  title: { rendered: "Products" },
                }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const result = await retrieveContent("Explain Kagen products");
    expect(result.items.map((item) => item.title)).toContain(
      "New Dynamic Product",
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("type=product"),
      expect.any(Object),
    );
  });
  it("retrieves only the PRISM and Products pages for a PRISM question", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify({
              id: url.includes("kagen-prism") ? 40 : 41,
              type: "page",
              slug: url.includes("kagen-prism") ? "kagen-prism" : "products",
              link: url.includes("kagen-prism")
                ? "https://kagen.ai/kagen-prism/"
                : "https://kagen.ai/products/",
              title: {
                rendered: url.includes("kagen-prism")
                  ? "Kagen PRISM AI-first Content Intelligence Platform"
                  : "Products",
              },
              content: { rendered: "<p>Official page content</p>" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const result = await retrieveContent("What is Kagen PRISM?");
    expect(result.intent).toBe("product_detail");
    expect(result.items.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        "Kagen PRISM AI-first Content Intelligence Platform",
        "Products",
      ]),
    );
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("type=product"),
      expect.any(Object),
    );
  });
  it("selects the matching dynamic AI Voice product and Products page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url.includes("type=product")
          ? [
              {
                id: 51,
                type: "product",
                slug: "kagen-add",
                link: "https://kagen.ai/product/kagen-add/",
                title: { rendered: "Kagen ADD" },
                content: { rendered: "<p>Software delivery</p>" },
              },
              {
                id: 52,
                type: "product",
                slug: "kagen-voice",
                link: "https://kagen.ai/product/kagen-voice/",
                title: { rendered: "Kagen VOICE AI Voice Agents" },
                content: {
                  rendered: "<p>AI voice agents for call automation</p>",
                },
              },
            ]
          : {
              id: 53,
              type: "page",
              slug: "products",
              link: "https://kagen.ai/products/",
              title: { rendered: "Products" },
            };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const result = await retrieveContent("do you know about AI voice");
    expect(result.intent).toBe("product_detail");
    expect(result.items.map((item) => item.title)).toEqual([
      "Kagen VOICE AI Voice Agents",
      "Products",
    ]);
  });
  it("uses the Home page instead of the disabled About page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 30,
              type: "page",
              slug: "home",
              link: "https://kagen.ai/",
              title: { rendered: "Home" },
              content: {
                rendered: "<h2>About Kagen</h2><p>Company overview</p>",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const result = await retrieveContent("Who is Kagen?");
    expect(result.intent).toBe("about");
    expect(result.items[0]?.plainText).toContain("About Kagen");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/pages/home"),
      expect.any(Object),
    );
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/pages/about-us"),
      expect.any(Object),
    );
  });
  it("maps the phonetic Kaga Eye query to Home page company content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 31,
              type: "page",
              slug: "home",
              link: "https://kagen.ai/",
              title: { rendered: "Home" },
              acf: {
                hero_description:
                  "Kagen AI unifies enterprise intelligence with agentic workflows.",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const result = await retrieveContent("do you know about kaga eye");
    expect(result.intent).toBe("about");
    expect(result.items[0]?.excerpt).toContain(
      "Kagen AI unifies enterprise intelligence",
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/pages/home"),
      expect.any(Object),
    );
  });
  it("does not substitute generic pages when API search has no results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const result = await retrieveContent("unknown unpublished subject");
    expect(result.items).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
describe("actionable product follow-ups", () => {
  it("builds a real comparison and does not repeat the compare suggestion", () => {
    const products = [
      {
        id: 1,
        type: "product",
        slug: "one",
        title: "Product One",
        excerpt: "Automates document workflows",
        plainText: "Automates document workflows",
        url: "https://kagen.ai/one",
        acfText: "",
        extractedUrls: [],
      },
      {
        id: 2,
        type: "product",
        slug: "two",
        title: "Product Two",
        excerpt: "Supports voice automation",
        plainText: "Supports voice automation",
        url: "https://kagen.ai/two",
        acfText: "",
        extractedUrls: [],
      },
    ];
    const response = buildProductComparison(products);
    expect(response).not.toBeNull();
    if (!response) throw new Error("Expected API-backed comparison");
    expect(response.answer).toContain("| Product | Published overview |");
    expect(response.answer).toContain("Product One");
    expect(response.cards).toHaveLength(2);
    expect(response.suggestions).not.toContain("Compare these products");
  });
  it("builds product details only from retrieved API fields", () => {
    const response = buildContentDetail([
      {
        id: 7,
        type: "page",
        slug: "prism",
        title: "Kagen PRISM",
        excerpt: "Official PRISM overview from WordPress.",
        plainText: "Kagen PRISM Official PRISM overview from WordPress.",
        url: "https://kagen.ai/prism",
        acfText: "",
        extractedUrls: [],
      },
    ]);
    expect(response?.answer).toContain(
      "Official PRISM overview from WordPress",
    );
    expect(response?.cards).toHaveLength(1);
    expect(response?.sources).toEqual([
      { title: "Kagen PRISM", url: "https://kagen.ai/prism" },
    ]);
  });
});
describe("widget configuration", () => {
  it("validates colors, URLs, and constrains dimensions", () => {
    expect(hexColorSchema.safeParse("#11AAff").success).toBe(true);
    expect(hexColorSchema.safeParse("red").success).toBe(false);
    expect(httpUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(httpUrlSchema.safeParse("http://example.com/widget").success).toBe(
      false,
    );
    const parsed = parseWidgetQuery(
      new URLSearchParams(
        "width=999&height=1&zIndex=-5&position=top&primaryColor=red",
      ),
    );
    expect(parsed).toMatchObject({
      width: 400,
      height: 650,
      zIndex: 2147483000,
      position: "bottom-right",
      primaryColor: "#0063ce",
    });
    expect(readableForeground("#ffffff")).toBe("#111827");
    expect(readableForeground("#111827")).toBe("#ffffff");
  });
  it("validates postMessage origins through shape and namespace", () => {
    expect(
      widgetMessageSchema.safeParse({
        namespace: "kagen-chat",
        type: "KAGEN_CHAT_READY",
      }).success,
    ).toBe(true);
    expect(
      widgetMessageSchema.safeParse({
        namespace: "other",
        type: "KAGEN_CHAT_READY",
      }).success,
    ).toBe(false);
    expect(
      widgetMessageSchema.safeParse({ namespace: "kagen-chat", type: "EVIL" })
        .success,
    ).toBe(false);
  });
  it("enforces configured CORS origins", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://kagen.ai");
    vi.stubEnv("WIDGET_ALLOWED_ORIGINS", "https://partner.example");
    expect(corsHeaders("https://partner.example").isAllowed).toBe(true);
    expect(corsHeaders("https://evil.example").isAllowed).toBe(false);
    expect(
      corsHeaders("https://kagen.ai").headers["Access-Control-Allow-Origin"],
    ).toBe("https://kagen.ai");
    vi.unstubAllEnvs();
  });
  it("protects duplicate initialization and exposes only the public API", () => {
    const script = readFileSync("public/kagen-chat-widget.js", "utf8");
    expect(script).toContain(
      "window.KagenChat && window.KagenChat.__initialized",
    );
    for (const method of ["open", "close", "toggle", "destroy", "isOpen"])
      expect(script).toContain(`${method}:`);
    expect(script).toContain("event.origin !== widgetOrigin");
    expect(script).toContain("event.source !== frame.contentWindow");
  });
});
describe("complete ACF search indexing", () => {
  it("preserves paragraphs and overlap while chunking long content", () => {
    const chunks = buildSearchChunks(10, [
      `First paragraph ${"foundation ".repeat(90)}`,
      `Middle paragraph ${"accuracy ".repeat(90)}`,
      `Final paragraph ${"complexity ".repeat(90)}`,
    ]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= 2200)).toBe(true);
    expect(
      chunks.some((chunk) => chunk.text.includes("Middle paragraph")),
    ).toBe(true);
  });
  it("extracts nested template fields and excludes image metadata", () => {
    const extracted = extractAcfContent({
      product_template_3_hero_heading: "Agentic Driven Delivery",
      product_template_3_sections: [
        {
          heading: "Swarm Intelligence",
          description:
            "Multiple implementations run in parallel and evaluate trade-offs.",
        },
      ],
      hero_image: {
        ID: 99,
        filename: "screenshot.png",
        width: 1200,
        sizes: { thumbnail: "https://kagen.ai/thumb.png" },
        url: "https://kagen.ai/hero.png",
        alt: "Agentic delivery workflow",
      },
    });
    expect(extracted.headings).toEqual(
      expect.arrayContaining(["Agentic Driven Delivery", "Swarm Intelligence"]),
    );
    expect(extracted.descriptions).toContain(
      "Multiple implementations run in parallel and evaluate trade-offs.",
    );
    expect(extracted.textSegments.join(" ")).not.toContain("screenshot.png");
    expect(extracted.images).toEqual([
      {
        url: "https://kagen.ai/hero.png",
        alt: "Agentic delivery workflow",
        title: undefined,
      },
    ]);
  });
  it("cleans repeated phrases and duplicate repeaters", () => {
    expect(cleanText("E-commerceE-commerce")).toBe("E-commerce");
    expect(
      cleanText(
        "AI-Native Voice PlatformAI-Native Voice PlatformAI-Native Voice Platform",
      ),
    ).toBe("AI-Native Voice Platform");
    expect(
      deduplicateSegments(["Secure workflows", "secure workflows", "Other"]),
    ).toEqual(["Secure workflows", "Other"]);
  });
  it("rejects FAQ answers that only repeat their question", () => {
    const extracted = extractAcfContent({
      faq_items: [
        { question: "What is VOICE?", answer: "What is VOICE?" },
        {
          question: "How does it help?",
          answer: "It automates published voice workflows securely.",
        },
      ],
    });
    expect(extracted.faqItems).toHaveLength(1);
    expect(extracted.faqItems[0]?.question).toBe("How does it help?");
  });
  it("discovers a product-like PRISM page and ranks aliases exactly", () => {
    const document = buildSearchDocument({
      id: 80,
      type: "page",
      slug: "kagen-prism-ai-first-content-intelligence-platform",
      link: "https://kagen.ai/kagen-prism/",
      title: {
        rendered: "Kagen PRISM AI-first Content Intelligence Platform",
      },
      acf: {
        hero_description:
          "An AI-first content intelligence platform for enterprises.",
      },
    });
    expect(document.productLike).toBe(true);
    expect(document.aliases).toContain("kagen prism");
    expect(rankSearchDocument(document, "kagen prism").score).toBeGreaterThan(
      100,
    );
    expect(rankSearchDocument(document, "prism").score).toBeGreaterThan(100);
  });
  it("normalizes conversational queries without removing product entities", () => {
    expect(normalizeQuery("Do you know about Kagen EYE?")).toBe("kagen eye");
    expect(normalizeQuery("Please explain Kagen ADD")).toBe("kagen add");
  });
  it("does not treat an isolated EYE acronym as the Kagen EYE entity", () => {
    const document = buildSearchDocument({
      id: 81,
      type: "case-studies",
      slug: "unrelated-case-study",
      link: "https://kagen.ai/case-study/",
      title: { rendered: "Conversational AI Case Study" },
      acf: {
        heading: "EYE",
        description:
          "A published case study about conversational voice interactions.",
      },
    });
    expect(rankSearchDocument(document, "kagen eye").score).toBeLessThan(55);
  });
  it("converts only the configured WordPress localhost origin", () => {
    vi.stubEnv(
      "KAGEN_API_BASE_URL",
      "http://localhost/wp-kagen/wp-json/kagen/v1",
    );
    vi.stubEnv("KAGEN_PUBLIC_SITE_URL", "https://kagen.ai");
    expect(
      normalizeWordPressUrl("http://localhost/wp-kagen/product/voice/"),
    ).toBe("https://kagen.ai/product/voice/");
    expect(normalizeWordPressUrl("https://cdn.example.com/video.mp4")).toBe(
      "https://cdn.example.com/video.mp4",
    );
    vi.unstubAllEnvs();
  });
  it("preserves the local WordPress subdirectory when it is public", () => {
    vi.stubEnv(
      "KAGEN_API_BASE_URL",
      "http://localhost/wp-kagen/wp-json/kagen/v1",
    );
    vi.stubEnv("KAGEN_PUBLIC_SITE_URL", "http://localhost/wp-kagen");
    expect(
      normalizeWordPressUrl("http://localhost/wp-kagen/product/voice/"),
    ).toBe("http://localhost/wp-kagen/product/voice/");
    vi.unstubAllEnvs();
  });
  it("loads every WordPress pagination page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const page = new URL(url).searchParams.get("page");
        return new Response(
          JSON.stringify([
            {
              id: page === "1" ? 1 : 2,
              type: "page",
              slug: `page-${page}`,
              link: `https://kagen.ai/page-${page}/`,
              title: { rendered: `Page ${page}` },
            },
          ]),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-WP-TotalPages": "2",
            },
          },
        );
      }),
    );
    const items = await fetchAllPublishedContent();
    expect(items.map((item) => item.id)).toEqual([1, 2]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("returns empty retrieval context without inventing matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify([]), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-WP-TotalPages": "1",
            },
          }),
      ),
    );
    const result = await retrieveFromIndex("Kagen UNKNOWN");
    expect(result.reliableMatchFound).toBe(false);
    expect(result.matches).toEqual([]);
  });
  it("retrieves an article from an exact sentence in the middle of its body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                id: 803,
                type: "post",
                slug: "enterprise-ai-voice-agent-buying-guide-2026",
                link: "https://kagen.ai/blog/voice-guide/",
                title: {
                  rendered:
                    "The 2026 Enterprise AI and AI Voice Agent Buying Guide",
                },
                content: {
                  rendered: `<h3>Accuracy &amp; Voice Intelligence</h3>
                    <p>At the core of any AI voice agent is its ability to understand and respond accurately.</p>
                    <p>While most vendors demonstrate near-perfect conversations in controlled environments, real-world conditions are far more complex.</p>
                    <p>An enterprise-grade system must recognize speech across accents and noisy environments.</p>`,
                },
              },
              {
                id: 804,
                type: "post",
                slug: "unrelated",
                link: "https://kagen.ai/blog/unrelated/",
                title: { rendered: "Document Automation Overview" },
                content: {
                  rendered:
                    "<p>Automate document workflows with governed content intelligence.</p>",
                },
              },
            ]),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "X-WP-TotalPages": "1",
              },
            },
          ),
      ),
    );
    const result = await retrieveFromIndex(
      "most vendors demonstrate near-perfect conversations in controlled environments, real-world conditions are far more complex.",
    );
    expect(result.reliableMatchFound).toBe(true);
    expect(result.matches[0]?.document.id).toBe(803);
    expect(result.matches[0]?.matchedFields).toContain("exact-content-phrase");
    expect(result.matches[0]?.selectedPassages[0]).toContain(
      "real-world conditions are far more complex",
    );
  });
  it("searches recursively nested ACF prose using paraphrased keywords", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                id: 900,
                type: "product",
                slug: "voice",
                link: "https://kagen.ai/product/voice/",
                title: { rendered: "Kagen VOICE" },
                acf: {
                  flexible_sections: [
                    {
                      tabs: [
                        {
                          rich_text:
                            "<p>Reliable speech automation handles challenging customer calls in noisy environments.</p>",
                        },
                      ],
                    },
                  ],
                },
              },
            ]),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "X-WP-TotalPages": "1",
              },
            },
          ),
      ),
    );
    const result = await retrieveFromIndex(
      "accurate voice platform for complex client conversations",
    );
    expect(result.reliableMatchFound).toBe(true);
    expect(result.matches[0]?.document.id).toBe(900);
    expect(result.matches[0]?.matchedFields).toContain("semantic-expansion");
  });
  it("surfaces WordPress API failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unavailable", { status: 503 })),
    );
    await expect(fetchAllPublishedContent()).rejects.toThrow(
      "WordPress returned 503",
    );
  });
});
