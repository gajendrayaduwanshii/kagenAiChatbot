import { ChatWindow } from "@/components/chat/chat-window";
import { parseWidgetQuery, readableForeground } from "@/lib/widget-config";

export const dynamic = "force-dynamic";

export default async function EmbedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  Object.entries(raw).forEach(([key, value]) => {
    if (typeof value === "string") params.set(key, value);
  });
  const config = parseWidgetQuery(params);
  const candidateApi = params.get("apiUrl");
  let apiUrl: string | undefined;
  try {
    if (candidateApi) {
      const parsed = new URL(candidateApi);
      if (
        parsed.protocol === "https:" ||
        (parsed.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(parsed.hostname))
      )
        apiUrl = parsed.toString();
    }
  } catch {
    /* use same-origin API */
  }
  return (
    <main
      className="embed-page"
      style={
        {
          "--kagen-chat-primary": config.primaryColor,
          "--kagen-chat-primary-text": readableForeground(config.primaryColor),
          "--kagen-chat-background": "#ffffff",
          "--kagen-chat-text": "#172033",
          "--kagen-chat-border": "#e5e8f0",
          "--kagen-chat-radius": "16px",
        } as React.CSSProperties
      }
    >
      <ChatWindow
        embedded
        widget
        title={config.title}
        welcomeMessage={config.welcomeMessage}
        primaryColor={config.primaryColor}
        apiUrl={apiUrl}
        logoUrl={config.logoUrl || undefined}
      />
    </main>
  );
}
