"use client";
import { CalendarDays, ExternalLink } from "lucide-react";
import type { AssistantResponse } from "@/lib/llm/schemas";
export function ResultCard({
  card,
}: {
  card: AssistantResponse["cards"][number];
}) {
  return (
    <article className="result-card">
      {/* URLs are dynamic WordPress assets; native lazy loading avoids a brittle hostname allowlist. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {card.image && <img src={card.image} alt="" loading="lazy" />}
      <div className="result-content">
        <span className="badge">
          {card.badge || card.type.replace("-", " ")}
        </span>
        <h3>{card.title}</h3>
        {card.date && (
          <div className="card-date">
            <CalendarDays size={13} />
            {new Date(card.date).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </div>
        )}
        <p>{card.description}</p>
        <a
          href={card.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("kagen-chat:link-clicked", {
                detail: { cardType: card.type },
              }),
            )
          }
        >
          Learn more <ExternalLink size={14} />
        </a>
      </div>
    </article>
  );
}
