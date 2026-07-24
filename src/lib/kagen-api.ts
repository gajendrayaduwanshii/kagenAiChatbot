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
