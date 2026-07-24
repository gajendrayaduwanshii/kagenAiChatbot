import { getEnv } from "./env";
import type { WordPressItem } from "@/types/wordpress";

export class KagenApiError extends Error {
  constructor(
    message: string,
    public kind: "timeout" | "unavailable" | "invalid",
  ) {
    super(message);
  }
}

export async function fetchKagen(path: string): Promise<WordPressItem[]> {
  const base = getEnv().KAGEN_API_BASE_URL.replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${base}${path}`, {
      signal: controller.signal,
      next: { revalidate: 300 },
      headers: { Accept: "application/json" },
    });
    if (!response.ok)
      throw new KagenApiError(
        `WordPress returned ${response.status}`,
        "unavailable",
      );
    const json: unknown = await response.json();
    const data = Array.isArray(json)
      ? json
      : typeof json === "object" && json !== null && "data" in json
        ? (json as { data: unknown }).data
        : json;
    if (Array.isArray(data)) return data as WordPressItem[];
    if (typeof data === "object" && data !== null)
      return [data as WordPressItem];
    throw new KagenApiError(
      "WordPress returned an unexpected response",
      "invalid",
    );
  } catch (error) {
    if (error instanceof KagenApiError) throw error;
    if (error instanceof Error && error.name === "AbortError")
      throw new KagenApiError("WordPress request timed out", "timeout");
    throw new KagenApiError(
      "Could not reach the Kagen content service",
      "unavailable",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAllPublishedContent(): Promise<WordPressItem[]> {
  const first = await fetchKagenPage(1);
  if (first.totalPages <= 1) return first.items;
  const remaining = await Promise.all(
    Array.from({ length: first.totalPages - 1 }, (_, index) =>
      fetchKagenPage(index + 2),
    ),
  );
  return [...first.items, ...remaining.flatMap((page) => page.items)];
}

async function fetchKagenPage(
  page: number,
): Promise<{ items: WordPressItem[]; totalPages: number }> {
  const base = getEnv().KAGEN_API_BASE_URL.replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      `${base}/content?type=all&per_page=100&page=${page}`,
      {
        signal: controller.signal,
        next: { revalidate: 300 },
        headers: { Accept: "application/json" },
      },
    );
    if (!response.ok)
      throw new KagenApiError(
        `WordPress returned ${response.status}`,
        "unavailable",
      );
    const json: unknown = await response.json();
    if (!Array.isArray(json))
      throw new KagenApiError(
        "WordPress returned an unexpected response",
        "invalid",
      );
    const totalPages = Math.max(
      1,
      Number(response.headers.get("X-WP-TotalPages") ?? "1") || 1,
    );
    return { items: json as WordPressItem[], totalPages };
  } catch (error) {
    if (error instanceof KagenApiError) throw error;
    if (error instanceof Error && error.name === "AbortError")
      throw new KagenApiError("WordPress request timed out", "timeout");
    throw new KagenApiError(
      "Could not reach the Kagen content service",
      "unavailable",
    );
  } finally {
    clearTimeout(timeout);
  }
}
