import type { Response } from "express";
import { config } from "./config.js";
import {
  countChatMessages,
  deleteMessage,
  getChat,
  insertMessage,
  lastMessage,
  renameChat,
  type ChatRow,
  type MessageRow,
} from "./db.js";
import { describeError, generateTitle, streamReply, StreamAbortedError } from "./claude.js";
import { buildHistory, buildSystem } from "./prompt.js";

const HEARTBEAT_MS = 15000;

const busy = new Map<string, AbortController>();

export const isBusy = (chatId: string): boolean => busy.has(chatId);

export const stopChat = (chatId: string): boolean => {
  const controller = busy.get(chatId);
  if (!controller) return false;
  controller.abort();
  return true;
};

const openStream = (res: Response): void => {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
};

const emit = (res: Response, event: string, data: unknown): void => {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

const refusalMessage = (category: string | null): string => {
  const suffix = category ? ` (Kategorie: ${category})` : "";
  return `Die Sicherheitsfilter des Modells haben diese Anfrage abgelehnt${suffix}. Formuliere sie anders oder versuche es erneut.`;
};

export interface RunOptions {
  chatId: string;
  userMessage?: MessageRow;
}

export const runCompletion = async (res: Response, options: RunOptions): Promise<void> => {
  const { chatId, userMessage } = options;
  const controller = new AbortController();
  busy.set(chatId, controller);
  openStream(res);

  const release = (): void => {
    busy.delete(chatId);
  };

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(": keep-alive\n\n");
  }, HEARTBEAT_MS);

  try {
    if (userMessage) emit(res, "user", userMessage);

    const history = buildHistory(chatId);
    const system = buildSystem(chatId);

    let result;
    try {
      result = await streamReply({
        system,
        messages: history,
        signal: controller.signal,
        onText: (delta) => emit(res, "delta", { text: delta }),
        onThinking: (delta) => emit(res, "thinking", { text: delta }),
        onSwitch: (from, to) => emit(res, "switch", { from, to }),
      });
    } catch (error) {
      if (error instanceof StreamAbortedError) {
        const stored = error.partial.text.trim()
          ? insertMessage({
              chat_id: chatId,
              role: "assistant",
              content: error.partial.text,
              thinking: error.partial.thinking || null,
              stop_reason: "aborted",
              model: config.model,
            })
          : null;
        emit(res, "stopped", { message: stored, chat: getChat(chatId) });
        return;
      }
      const described = describeError(error);
      console.error("[claude]", error instanceof Error ? error.message : error);
      emit(res, "error", { message: described.message });
      return;
    }

    if (result.stopReason === "refusal") {
      emit(res, "error", { message: refusalMessage(result.stopCategory) });
      return;
    }

    if (!result.text.trim()) {
      emit(res, "error", {
        message:
          result.stopReason === "max_tokens"
            ? "Das Token-Limit wurde erreicht, bevor eine Antwort entstanden ist. Erhöhe MAX_TOKENS oder senke CLAUDE_EFFORT."
            : "Das Modell hat keine Antwort geliefert. Bitte erneut versuchen.",
      });
      return;
    }

    const stored = insertMessage({
      chat_id: chatId,
      role: "assistant",
      content: result.text,
      thinking: result.thinking || null,
      stop_reason: result.stopReason,
      model: result.model,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    });

    const chat = getChat(chatId) as ChatRow;
    emit(res, "done", { message: stored, chat, fallbackUsed: result.fallbackUsed, account: result.account });
    release();

    if (countChatMessages(chatId) === 2) {
      const lastUser = [...history].reverse().find((item) => item.role === "user");
      const title = await generateTitle(lastUser?.content ?? "", result.text);
      renameChat(chatId, title);
      emit(res, "title", { id: chatId, title });
    }
  } catch (error) {
    console.error("[chat-runner]", error);
    emit(res, "error", { message: "Unerwarteter Serverfehler." });
  } finally {
    clearInterval(heartbeat);
    release();
    if (!res.writableEnded) res.end();
  }
};

export const dropTrailingAssistant = (chatId: string): void => {
  const last = lastMessage(chatId);
  if (last && last.role === "assistant") deleteMessage(last.id);
};
