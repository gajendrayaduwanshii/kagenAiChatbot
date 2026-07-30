import type { AssistantResponse } from "./llm/schemas";

const GREETING =
  /^(?:hi|hii+|hello|hey|good\s+(?:morning|afternoon|evening)|namaste)[!,.?\s]*$/i;

export function isGreeting(message: string): boolean {
  return GREETING.test(message.trim());
}

export function greetingResponse(): AssistantResponse {
  return {
    answer:
      "Hi! I’m the Kagen AI Assistant. What would you like to explore today?",
    cards: [],
    suggestions: [
      "Explore Kagen products",
      "Show me case studies",
      "What is Kagen PRISM?",
      "Contact Kagen",
    ],
    sources: [],
    confidence: "high",
    insufficientContext: false,
  };
}
