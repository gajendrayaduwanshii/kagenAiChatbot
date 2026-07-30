"use client";
import { HttpAgent, type AgentSubscriber } from "@ag-ui/client";
import type { Message as AgUiMessage } from "@ag-ui/core";
import { RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { assistantResponseSchema } from "@/lib/llm/schemas";
import type { ChatMessage } from "@/types/chat";
import { ChatInput } from "./chat-input";
import { ChatMessage as Message } from "./chat-message";
import { TypingIndicator } from "./typing-indicator";

const starters = [
  "Explain Kagen products",
  "Show me case studies",
  "What is Kagen PRISM?",
  "Show the latest Kagen resources",
  "How can I contact Kagen?",
];
const defaultWelcome =
  "Hello! I’m the Kagen AI Assistant. I can help you explore Kagen’s products, customer stories, resources, events, and more. What would you like to know?";
const storageKey = "kagen-chat:conversation:v1";

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
const emit = (name: string, detail: Record<string, unknown> = {}) => {
  window.dispatchEvent(new CustomEvent(`kagen-chat:${name}`, { detail }));
};
export function ChatWindow({
  widget = false,
  embedded = false,
  title = "Kagen Assistant",
  welcomeMessage = defaultWelcome,
  primaryColor,
  apiUrl,
  logoUrl,
  parentOrigin,
}: ChatWindowProps) {
  const welcome: ChatMessage = {
    id: "welcome",
    role: "assistant",
    content: welcomeMessage,
  };
  const [messages, setMessages] = useState<ChatMessage[]>([welcome]);
  const [loading, setLoading] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const sessionId = useRef("");
  const postParent = useCallback(
    (type: string, payload?: Record<string, unknown>) => {
      if (!embedded) return;
      try {
        const parsedReferrerOrigin = document.referrer
          ? new URL(document.referrer).origin
          : undefined;
        const referrerOrigin =
          parsedReferrerOrigin === "null" ? "*" : parsedReferrerOrigin;
        const trustedParentOrigin = referrerOrigin || parentOrigin;
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
    try {
      sessionId.current =
        sessionStorage.getItem("kagen-chat:session:v1") || crypto.randomUUID();
      sessionStorage.setItem("kagen-chat:session:v1", sessionId.current);
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const restored = JSON.parse(saved) as ChatMessage[];
        queueMicrotask(() => setMessages(restored));
      }
    } catch {
      sessionId.current = crypto.randomUUID();
    }
    postParent("KAGEN_CHAT_READY");
  }, [postParent]);
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      /* storage may be blocked */
    }
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);
  const send = useCallback(
    async (text: string) => {
      if (loading) return;
      const user: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };
      setMessages((current) => [...current, user]);
      setLoading(true);
      emit("message-submitted", {
        messageLengthCategory:
          text.length < 80 ? "short" : text.length < 300 ? "medium" : "long",
      });
      const startedAt = performance.now();
      let protocolErrorReceived = false;
      try {
        const initialMessages: AgUiMessage[] = [...messages, user]
          .filter((message) => message.id !== "welcome")
          .slice(-11)
          .map((message) => ({
            id: message.id,
            role: message.role,
            content: message.response?.answer ?? message.content,
          }));
        const agent = new HttpAgent({
          url: apiUrl || process.env.NEXT_PUBLIC_CHAT_API_URL || "/api/ag-ui",
          threadId: sessionId.current,
          initialMessages,
        });
        const subscriber: AgentSubscriber = {
          onTextMessageStartEvent: ({ event }) => {
            setMessages((current) => [
              ...current,
              { id: event.messageId, role: "assistant", content: "" },
            ]);
          },
          onTextMessageContentEvent: ({ event }) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === event.messageId
                  ? { ...message, content: message.content + event.delta }
                  : message,
              ),
            );
          },
          onCustomEvent: ({ event }) => {
            if (event.name !== "kagen.ui.response") return;
            const value =
              typeof event.value === "object" && event.value !== null
                ? event.value
                : {};
            const messageId =
              "messageId" in value && typeof value.messageId === "string"
                ? value.messageId
                : "";
            const dynamicUi = assistantResponseSchema.safeParse({
              answer: "dynamic",
              ...value,
            });
            if (!messageId || !dynamicUi.success) return;
            setMessages((current) =>
              current.map((message) =>
                message.id === messageId
                  ? {
                      ...message,
                      response: {
                        ...dynamicUi.data,
                        answer: message.content,
                      },
                    }
                  : message,
              ),
            );
          },
          onRunErrorEvent: ({ event }) => {
            protocolErrorReceived = true;
            setMessages((current) => [
              ...current,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: event.message,
                errorCode: event.code,
              },
            ]);
          },
        };
        await agent.runAgent({}, subscriber);
        const duration = performance.now() - startedAt;
        emit("response-received", {
          durationCategory:
            duration < 2000 ? "fast" : duration < 6000 ? "normal" : "slow",
          protocol: "ag-ui",
        });
      } catch {
        // RUN_ERROR is the sole user-visible failure state. A transport failure
        // never becomes a locally invented assistant response.
        emit("api-error");
        if (!protocolErrorReceived) {
          postParent("KAGEN_CHAT_ERROR", { message: "AG-UI transport failed" });
        }
      } finally {
        setLoading(false);
      }
    },
    [apiUrl, loading, messages, postParent],
  );
  const clear = () => {
    setMessages([welcome]);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* storage may be blocked */
    }
  };
  const closeEmbed = () => postParent("KAGEN_CHAT_CLOSE");
  return (
    <section
      className={`chat-panel ${widget ? "widget-chat" : ""} ${embedded ? "embed-chat" : ""}`}
      aria-label="Kagen AI chat"
      style={
        primaryColor
          ? ({ "--brand": primaryColor } as React.CSSProperties)
          : undefined
      }
    >
      <div className="chat-header">
        <div>
          {logoUrl ? (
            <>
              {/* Dynamic HTTPS widget branding cannot use a fixed Next Image hostname allowlist. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="chat-logo" src={logoUrl} alt="" />
            </>
          ) : (
            <span className="online" />
          )}
          {title}
        </div>
        <div className="chat-actions">
          <button
            type="button"
            onClick={clear}
            aria-label="Clear conversation"
            title="Clear conversation"
          >
            <Trash2 size={16} />
            <span>Clear</span>
          </button>
          {embedded && (
            <button
              type="button"
              onClick={closeEmbed}
              aria-label="Close chat"
              title="Close chat"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>
      <div className="conversation" aria-live="polite">
        {messages.map((message) => (
          <Message key={message.id} message={message} onSuggestion={send} />
        ))}
        {messages.length === 1 && (
          <div className="starters">
            <div>
              <Sparkles size={14} /> Try asking
            </div>
            {starters.map((s) => (
              <button onClick={() => send(s)} key={s}>
                {s}
              </button>
            ))}
          </div>
        )}
        {loading && (
          <div className="message-row assistant">
            <div className="avatar">
              <Sparkles size={16} />
            </div>
            <TypingIndicator />
          </div>
        )}
        <div ref={end} />
      </div>
      <ChatInput onSend={send} disabled={loading} />
      {loading && (
        <button className="sr-only" aria-label="Request in progress">
          <RotateCcw />
        </button>
      )}
    </section>
  );
}
