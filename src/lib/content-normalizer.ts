import { extractUrls, htmlToText, safeHttpUrl } from "./html-utils";
import type {
  JsonValue,
  NormalizedContent,
  WordPressItem,
} from "@/types/wordpress";

const MAX_ITEM_LENGTH = 6000;

export function flattenAcf(value: JsonValue | undefined): {
  text: string;
  urls: string[];
  images: string[];
} {
  const texts: string[] = [];
  const urls: string[] = [];
  const images: string[] = [];
  const visit = (node: JsonValue | undefined, key = "") => {
    if (node == null || node === false || node === "") return;
    if (typeof node === "string") {
      const clean = htmlToText(node);
      if (clean && !texts.includes(clean)) texts.push(clean);
      for (const url of extractUrls(node)) {
        if (!urls.includes(url)) urls.push(url);
        if (
          /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url) ||
          /image/i.test(key)
        )
          images.push(url);
      }
      const direct = safeHttpUrl(node);
      if (direct && !urls.includes(direct)) urls.push(direct);
      if (
        direct &&
        (/image|photo|logo|thumbnail/i.test(key) ||
          /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(direct))
      )
        images.push(direct);
      return;
    }
    if (typeof node === "number" || typeof node === "boolean") return;
    if (Array.isArray(node)) return node.forEach((child) => visit(child, key));
    Object.entries(node).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(value);
  return {
    text: texts.join(" ").slice(0, MAX_ITEM_LENGTH),
    urls: [...new Set(urls)],
    images: [...new Set(images)],
  };
}

const rendered = (value: WordPressItem["title"] | WordPressItem["content"]) =>
  typeof value === "string" ? value : (value?.rendered ?? "");

export function normalizeContent(item: WordPressItem): NormalizedContent {
  const acf = flattenAcf(item.acf);
  const title = htmlToText(rendered(item.title)) || "Untitled";
  const excerpt = htmlToText(rendered(item.excerpt)).slice(0, 500);
  const body = htmlToText(rendered(item.content));
  const featured =
    typeof item.featured_image === "string"
      ? item.featured_image
      : (item.featured_image?.url ?? item.featured_image?.source_url);
  const textParts = [
    ...new Set([title, excerpt, body, acf.text].filter(Boolean)),
  ];
  return {
    id: item.id,
    type: item.type ?? "page",
    slug: item.slug ?? "",
    title,
    excerpt,
    plainText: textParts.join("\n").slice(0, MAX_ITEM_LENGTH),
    url: safeHttpUrl(item.link) ?? "",
    image: safeHttpUrl(featured) ?? acf.images[0],
    modified: item.modified ?? item.date,
    acfText: acf.text,
    extractedUrls: acf.urls,
  };
}
