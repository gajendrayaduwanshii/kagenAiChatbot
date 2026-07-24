import { afterEach, describe, expect, it, vi } from "vitest";
import { detectIntent } from "./intent-detector";
import { htmlToText } from "./html-utils";
import { flattenAcf, normalizeContent } from "./content-normalizer";
import { relevanceScore } from "./relevance-score";
import { assistantResponseSchema, filterResponseUrls } from "./llm/schemas";
import { retrieveContent } from "./content-retriever";
import { fallbackResponse } from "./fallback-response";
import { corsHeaders } from "./cors";
import {
  hexColorSchema,
  httpUrlSchema,
  parseWidgetQuery,
  readableForeground,
  widgetMessageSchema,
} from "./widget-config";
import { readFileSync } from "node:fs";

describe("intent detection", () => {
  it("detects specific intents before broad product terms", () => {
    expect(detectIntent("Tell me about Kagen PRISM platform")).toBe(
      "product_detail",
    );
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
  afterEach(() => vi.unstubAllGlobals());
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
    const response = fallbackResponse(
      products,
      "products",
      "Compare these products",
    );
    expect(response.answer).toContain("| Product | Overview |");
    expect(response.answer).toContain("Product One");
    expect(response.cards).toHaveLength(2);
    expect(response.suggestions).not.toContain("Compare these products");
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
