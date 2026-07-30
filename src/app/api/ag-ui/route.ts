import {
  EventType,
  RunAgentInputSchema,
  type BaseEvent,
  type Message,
} from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import { NextRequest } from "next/server";
import { assistantResponseSchema } from "@/lib/llm/schemas";
import { OPTIONS as legacyOptions, POST as legacyChat } from "../chat/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

function protocolResponse(
  events: AsyncGenerator<BaseEvent>,
  request: NextRequest,
  headers = new Headers(),
) {
  const eventEncoder = new EventEncoder({
    accept: request.headers.get("accept") ?? "text/event-stream",
  });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(eventEncoder.encodeBinary(event));
        }
      } finally {
        controller.close();
      }
    },
  });
  headers.set("Content-Type", eventEncoder.getContentType());
  headers.set("Cache-Control", "no-cache, no-store");
  headers.set("Connection", "keep-alive");
  headers.set("X-Accel-Buffering", "no");
  return new Response(stream, { headers });
}

function protocolError(
  request: NextRequest,
  code: string,
  message: string,
  status = 200,
) {
  async function* events(): AsyncGenerator<BaseEvent> {
    yield { type: EventType.RUN_ERROR, code, message };
  }
  const response = protocolResponse(events(), request);
  return status === 200
    ? response
    : new Response(response.body, {
        status,
        headers: response.headers,
      });
}

export async function OPTIONS(request: NextRequest) {
  return legacyOptions(request);
}

export async function POST(request: NextRequest) {
  let rawInput: unknown;
  try {
    rawInput = await request.json();
  } catch {
    return protocolError(
      request,
      "INVALID_REQUEST",
      "Please send a valid AG-UI request.",
      400,
    );
  }

  const parsed = RunAgentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return protocolError(
      request,
      "INVALID_REQUEST",
      parsed.error.issues[0]?.message ?? "Invalid AG-UI request.",
      400,
    );
  }

  const input = parsed.data;
  const conversationalMessages = input.messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
  const latestUser = [...conversationalMessages]
    .reverse()
    .find((message) => message.role === "user");
  const prompt = latestUser ? messageText(latestUser).trim() : "";
  if (prompt.length < 2) {
    return protocolError(
      request,
      "INVALID_REQUEST",
      "Please enter at least 2 characters.",
      400,
    );
  }

  const history = conversationalMessages
    .filter((message) => message.id !== latestUser?.id)
    .slice(-10)
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: messageText(message),
    }))
    .filter((message) => message.content);
  const legacyRequest = new NextRequest(
    new URL("/api/chat", request.nextUrl.origin),
    {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        message: prompt,
        history,
        sessionId: input.threadId,
      }),
    },
  );
  const legacyResponse = await legacyChat(legacyRequest);
  const responseBody: unknown = await legacyResponse.json();
  const responseHeaders = new Headers();
  for (const name of [
    "access-control-allow-origin",
    "access-control-allow-methods",
    "access-control-allow-headers",
    "access-control-allow-credentials",
    "vary",
  ]) {
    const value = legacyResponse.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  async function* events(): AsyncGenerator<BaseEvent> {
    yield {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    };
    if (
      !legacyResponse.ok ||
      typeof responseBody !== "object" ||
      responseBody === null ||
      !("data" in responseBody)
    ) {
      const failure =
        typeof responseBody === "object" &&
        responseBody !== null &&
        "error" in responseBody
          ? (
              responseBody as {
                error?: { code?: string; message?: string };
              }
            ).error
          : undefined;
      yield {
        type: EventType.RUN_ERROR,
        code: failure?.code ?? "AGENT_RUN_FAILED",
        message: failure?.message ?? "The agent run failed.",
      };
      return;
    }

    const validated = assistantResponseSchema.safeParse(
      (responseBody as { data: unknown }).data,
    );
    if (!validated.success) {
      yield {
        type: EventType.RUN_ERROR,
        code: "INVALID_AGENT_UI",
        message: "The agent returned an invalid dynamic UI payload.",
      };
      return;
    }

    const messageId = crypto.randomUUID();
    yield {
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
    };
    for (const delta of validated.data.answer.match(/[\s\S]{1,96}/g) ?? []) {
      yield {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta,
      };
    }
    yield { type: EventType.TEXT_MESSAGE_END, messageId };
    yield {
      type: EventType.CUSTOM,
      name: "kagen.ui.response",
      value: {
        messageId,
        cards: validated.data.cards,
        sources: validated.data.sources,
        suggestions: validated.data.suggestions,
        confidence: validated.data.confidence,
        insufficientContext: validated.data.insufficientContext,
      },
    };
    yield {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
      result: { messageId },
    };
  }

  return protocolResponse(events(), request, responseHeaders);
}
