"use client";

import { HttpAgent } from "@ag-ui/client";
import { CopilotKit, useCopilotChatInternal } from "@copilotkit/react-core";
import { useRenderTool } from "@copilotkit/react-core/v2";
import {
  AssistantMessage as CopilotAssistantMessage,
  type AssistantMessageProps,
  CopilotChat,
  UserMessage as CopilotUserMessage,
  type UserMessageProps,
} from "@copilotkit/react-ui";
import { Bot, ExternalLink, Trash2, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { resolveAgUiUrl } from "@/lib/ag-ui";
import { cardSchema } from "@/lib/llm/schemas";

const defaultWelcome =
  "Hi! I’m the Kagen AI Assistant. Ask me about Kagen products, customer stories, resources, or events.";

const defaultChips = [
  { title: "Explore products", message: "Explore Kagen products" },
  { title: "Customer stories", message: "Show me Kagen case studies" },
  { title: "Kagen PRISM", message: "What is Kagen PRISM?" },
  { title: "Contact Kagen", message: "How can I contact Kagen?" },
];

interface ChatWindowProps {
  widget?: boolean;
  embedded?: boolean;
  title?: string;
  welcomeMessage?: string;
  primaryColor?: string;
  apiUrl?: string;
  logoUrl?: string;
  parentOrigin?: string;
}

const generatedResponseSchema = z.object({
  query: z.string().max(1000),
  layout: z.enum([
    "conversation",
    "spotlight",
    "products",
    "stories",
    "editorial",
    "discovery",
  ]),
  cards: z.array(cardSchema).max(6),
  suggestions: z.array(z.string().min(2).max(160)).max(4),
});

function KagenResultCards({
  query,
  layout,
  cards,
  suggestions,
  onSuggestion,
}: {
  query: string;
  layout: z.infer<typeof generatedResponseSchema>["layout"];
  cards: z.infer<typeof generatedResponseSchema>["cards"];
  suggestions: string[];
  onSuggestion: (message: string) => void;
}) {
  const linkedSuggestions = suggestions.map((suggestion, index) => {
    const words = suggestion
      .toLocaleLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3);
    const matchingCard = cards
      .map((card) => ({
        card,
        score: words.filter((word) =>
          card.title.toLocaleLowerCase().includes(word),
        ).length,
      }))
      .sort((left, right) => right.score - left.score)[0];

    return {
      label: suggestion,
      url:
        matchingCard && matchingCard.score > 0
          ? matchingCard.card.url
          : cards[index]?.url,
    };
  });

  return (
    <div className={`ag-ui-result-block layout-${layout}`}>
      {cards.length > 0 && (
        <>
          <div className="ag-ui-result-heading">
            <span>Results for “{query}”</span>
            <small>{layout}</small>
          </div>
          <div className="ag-ui-result-grid">
            {cards.map((card) => (
              <a
                className="ag-ui-result-card"
                href={card.url}
                target="_blank"
                rel="noreferrer"
                key={`${card.type}:${card.url}`}
              >
                {card.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.image} alt="" />
                )}
                <div>
                  <span className="ag-ui-card-badge">
                    {card.badge || card.type}
                  </span>
                  <strong>{card.title}</strong>
                  <p>{card.description}</p>
                  <small>
                    View official content <ExternalLink size={12} />
                  </small>
                </div>
              </a>
            ))}
          </div>
        </>
      )}
      {suggestions.length > 0 && (
        <div className="ag-ui-dynamic-chips" aria-label="Suggested questions">
          {linkedSuggestions.map((suggestion) => (
            <span className="ag-ui-dynamic-chip" key={suggestion.label}>
              <button
                type="button"
                onClick={() => onSuggestion(suggestion.label)}
              >
                {suggestion.label}
              </button>
              {suggestion.url && (
                <a
                  href={suggestion.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open official page for ${suggestion.label}`}
                  title="Open official page"
                >
                  <ExternalLink size={13} />
                </a>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function KagenGenerativeUi() {
  const { sendMessage, isLoading } = useCopilotChatInternal();
  const sendSuggestion = useCallback(
    async (message: string) => {
      if (isLoading) return;

      await sendMessage(
        {
          id: crypto.randomUUID(),
          role: "user",
          content: message,
        },
        { followUp: true, clearSuggestions: true },
      );
    },
    [isLoading, sendMessage],
  );
  useRenderTool(
    {
      name: "show_kagen_response",
      agentId: "kagen",
      parameters: generatedResponseSchema,
      render: ({ status, parameters }) =>
        status === "inProgress" ||
        !parameters.cards ||
        !parameters.suggestions ||
        !parameters.layout ||
        !parameters.query ? (
          <div className="ag-ui-result-loading">
            Preparing a relevant interface…
          </div>
        ) : (
          <KagenResultCards
            query={parameters.query}
            layout={parameters.layout}
            cards={parameters.cards}
            suggestions={parameters.suggestions}
            onSuggestion={sendSuggestion}
          />
        ),
    },
    [sendSuggestion],
  );
  return null;
}

function AssistantWithAvatar(props: AssistantMessageProps) {
  return (
    <div className="copilot-message-with-avatar assistant-avatar-row">
      <span className="copilot-role-avatar ai-avatar" aria-hidden="true">
        <Bot size={17} />
      </span>
      <div className="copilot-message-content">
        <CopilotAssistantMessage {...props} />
      </div>
    </div>
  );
}

function UserWithAvatar(props: UserMessageProps) {
  return (
    <div className="copilot-message-with-avatar user-avatar-row">
      <span className="copilot-role-avatar user-avatar" aria-hidden="true">
        <UserRound size={17} />
      </span>
      <div className="copilot-message-content">
        <CopilotUserMessage {...props} />
      </div>
    </div>
  );
}

function ResetChatButton() {
  const { reset, isLoading } = useCopilotChatInternal();

  return (
    <button
      type="button"
      onClick={reset}
      disabled={isLoading}
      aria-label="Clear chat"
      title="Clear chat"
    >
      <Trash2 size={17} />
    </button>
  );
}

export function ChatWindow({
  widget = false,
  embedded = false,
  title = "Kagen AI Assistant",
  welcomeMessage = defaultWelcome,
  primaryColor,
  apiUrl,
  logoUrl,
  parentOrigin,
}: ChatWindowProps) {
  const [threadId] = useState(() => crypto.randomUUID());
  const agent = useMemo(
    () =>
      new HttpAgent({
        url: resolveAgUiUrl(
          apiUrl || process.env.NEXT_PUBLIC_CHAT_API_URL || "/api/chat",
        ),
        agentId: "kagen",
        threadId,
      }),
    [apiUrl, threadId],
  );
  const postParent = useCallback(
    (type: string, payload?: Record<string, unknown>) => {
      if (!embedded) return;
      try {
        const referrerOrigin = document.referrer
          ? new URL(document.referrer).origin
          : undefined;
        const trustedParentOrigin =
          (referrerOrigin === "null" ? "*" : referrerOrigin) || parentOrigin;
        if (!trustedParentOrigin || window.parent === window) return;
        window.parent.postMessage(
          { namespace: "kagen-chat", type, ...(payload ? { payload } : {}) },
          trustedParentOrigin,
        );
      } catch {
        /* no trusted parent referrer */
      }
    },
    [embedded, parentOrigin],
  );

  useEffect(() => {
    postParent("KAGEN_CHAT_READY");
  }, [postParent]);

  return (
    <section
      className={`chat-panel copilot-chat-panel ${widget ? "widget-chat" : ""} ${embedded ? "embed-chat" : ""}`}
      aria-label="Kagen AI chat"
      style={
        {
          ...(primaryColor ? { "--brand": primaryColor } : {}),
          "--copilot-kit-primary-color": primaryColor || "#0063ce",
          "--copilot-kit-contrast-color": "#ffffff",
          "--copilot-kit-background-color": "#ffffff",
          "--copilot-kit-secondary-color": "#f3f7fb",
        } as React.CSSProperties
      }
    >
      <CopilotKit
        agent="kagen"
        threadId={threadId}
        agents__unsafe_dev_only={{ kagen: agent }}
        enableInspector={false}
        showDevConsole={false}
      >
        <div className="chat-header copilot-kagen-header">
          <div>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="chat-logo" src={logoUrl} alt="" />
            ) : (
              <span className="online" />
            )}
            <span>{title}</span>
          </div>
          <div className="chat-header-actions">
            <ResetChatButton />
            {embedded && (
              <button
                type="button"
                onClick={() => postParent("KAGEN_CHAT_CLOSE")}
                aria-label="Close chat"
                title="Close chat"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
        <div className="copilot-chat-body">
          <KagenGenerativeUi />
          <CopilotChat
            disableSystemMessage
            suggestions={defaultChips}
            AssistantMessage={AssistantWithAvatar}
            UserMessage={UserWithAvatar}
            labels={{
              title,
              initial: welcomeMessage,
              placeholder: "Message Kagen AI…",
              error: "I couldn’t complete that request. Please try again.",
            }}
            onSubmitMessage={(message) => {
              window.dispatchEvent(
                new CustomEvent("kagen-chat:message-submitted", {
                  detail: {
                    messageLengthCategory:
                      message.length < 80
                        ? "short"
                        : message.length < 300
                          ? "medium"
                          : "long",
                  },
                }),
              );
            }}
            onError={() => {
              postParent("KAGEN_CHAT_ERROR", {
                message: "Chat request failed",
              });
            }}
          />
        </div>
      </CopilotKit>
    </section>
  );
}
