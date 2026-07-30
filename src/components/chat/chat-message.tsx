"use client";
import { Bot, ExternalLink, UserRound } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage as Message } from "@/types/chat";
import { ResultCard } from "./result-card";
export function ChatMessage({
  message,
  onSuggestion,
}: {
  message: Message;
  onSuggestion: (value: string) => void;
}) {
  const assistant = message.role === "assistant";
  return (
    <div className={`message-row ${assistant ? "assistant" : "user"}`}>
      <div className="avatar" aria-hidden>
        {assistant ? <Bot size={17} /> : <UserRound size={17} />}
      </div>
      <div className="message-wrap">
        <div className="bubble">
          {assistant ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {message.response?.answer ?? message.content}
            </ReactMarkdown>
          ) : (
            message.content
          )}
          {message.errorCode && (
            <span className="message-error-code">{message.errorCode}</span>
          )}
        </div>
        {message.response?.cards.length ? (
          <div className="card-grid">
            {message.response.cards.map((card) => (
              <ResultCard key={`${card.url}-${card.title}`} card={card} />
            ))}
          </div>
        ) : null}
        {message.response?.sources.length ? (
          <details className="sources">
            <summary>Sources ({message.response.sources.length})</summary>
            <div>
              {message.response.sources.map((source) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("kagen-chat:link-clicked", {
                        detail: { cardType: "source" },
                      }),
                    )
                  }
                >
                  {source.title}
                  <ExternalLink size={12} />
                </a>
              ))}
            </div>
          </details>
        ) : null}
        {message.response?.suggestions.length ? (
          <div className="suggestions">
            {message.response.suggestions.map((s) => (
              <button key={s} onClick={() => onSuggestion(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
