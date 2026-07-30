import { assistantResponseSchema } from "./llm/schemas";

export const KAGEN_RESPONSE_EVENT = "KAGEN_RESPONSE";

export function resolveAgUiUrl(chatApiUrl?: string): string {
  const configured =
    process.env.NEXT_PUBLIC_AG_UI_API_URL?.trim() || chatApiUrl?.trim();
  if (!configured) return "/api/ag-ui";

  try {
    const url = new URL(configured, window.location.href);
    if (url.pathname.endsWith("/api/chat")) {
      url.pathname = url.pathname.slice(0, -"/api/chat".length) + "/api/ag-ui";
    }
    return url.toString();
  } catch {
    return configured.replace(/\/api\/chat$/, "/api/ag-ui");
  }
}

export function parseKagenResponseEvent(value: unknown) {
  return assistantResponseSchema.safeParse(value);
}
