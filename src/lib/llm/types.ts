import type { HistoryMessage } from "@/types/chat";
import type { NormalizedContent } from "@/types/wordpress";
import type { AssistantResponse } from "./schemas";
export interface LLMInput {
  message: string;
  history: HistoryMessage[];
  context: NormalizedContent[];
}
export interface LLMProvider {
  generateStructuredResponse(input: LLMInput): Promise<AssistantResponse>;
}
