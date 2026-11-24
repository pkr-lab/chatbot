import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import {
  AllAccountsExhaustedError,
  availableAccounts,
  earliestAvailability,
  markFailure,
  primaryClient,
  recordHeaders,
} from "./accounts.js";
import type { HistoryMessage, SystemBlock } from "./prompt.js";

export interface StreamResult {
  text: string;
  thinking: string;
  stopReason: string | null;
  stopCategory: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  fallbackUsed: boolean;
  account: string;
}

export interface StreamInput {
  system: SystemBlock[];
  messages: HistoryMessage[];
  signal: AbortSignal;
  onText: (delta: string) => void;
  onThinking: (delta: string) => void;
  onSwitch: (from: string, to: string) => void;
}

export class StreamAbortedError extends Error {
  constructor(
    public readonly partial: { text: string; thinking: string },
    options?: ErrorOptions,
  ) {
    super("stream aborted", options);
  }
}

const attempt = async (
  account: { name: string; client: Anthropic },
  input: StreamInput,
  progress: { started: boolean },
): Promise<StreamResult> => {
  const stream = account.client.beta.messages.stream(
    {
      model: config.model,
      max_tokens: config.maxTokens,
      thinking: { type: "adaptive", display: config.showThinking ? "summarized" : "omitted" },
      output_config: { effort: config.effort },
      cache_control: { type: "ephemeral" },
      system: input.system,
      messages: input.messages,
      ...(config.enableFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    },
    { signal: input.signal },
  );
  stream.withResponse().then(({ response }) => recordHeaders(account.name, response.headers), () => undefined);

  let text = "";
  let thinking = "";
  try {
    for await (const event of stream) {
      if (event.type !== "content_block_delta") continue;
      if (event.delta.type === "text_delta") {
        progress.started = true;
        text += event.delta.text;
        input.onText(event.delta.text);
      } else if (event.delta.type === "thinking_delta") {
        progress.started = true;
        thinking += event.delta.thinking;
        input.onThinking(event.delta.thinking);
      }
    }
    const final = await stream.finalMessage();
    const fallbackUsed = (final.usage.iterations ?? []).some((entry) => entry.type === "fallback_message");
    const details = final.stop_details as { category?: string | null } | null | undefined;
    return {
      text,
      thinking,
      stopReason: final.stop_reason,
      stopCategory: details?.category ?? null,
      model: final.model,
      inputTokens:
        final.usage.input_tokens + (final.usage.cache_read_input_tokens ?? 0) + (final.usage.cache_creation_input_tokens ?? 0),
      outputTokens: final.usage.output_tokens,
      fallbackUsed,
      account: account.name,
    };
  } catch (error) {
    if (input.signal.aborted || error instanceof Anthropic.APIUserAbortError) {
      throw new StreamAbortedError({ text, thinking }, { cause: error });
    }
    throw error;
  }
};

export const streamReply = async (input: StreamInput): Promise<StreamResult> => {
  const accounts = availableAccounts();
  if (accounts.length === 0) throw new AllAccountsExhaustedError(earliestAvailability());
  const progress = { started: false };
  let previous: string | null = null;
  for (let index = 0; index < accounts.length; index += 1) {
    const account = accounts[index] as { name: string; client: Anthropic };
    if (previous) input.onSwitch(previous, account.name);
    try {
      return await attempt(account, input, progress);
    } catch (error) {
      if (error instanceof StreamAbortedError) throw error;
      if (error instanceof Anthropic.APIError && error.headers) recordHeaders(account.name, error.headers);
      const switchable = markFailure(account.name, error);
      if (!switchable || progress.started) throw error;
      previous = account.name;
      if (index === accounts.length - 1) throw new AllAccountsExhaustedError(earliestAvailability());
    }
  }
  throw new AllAccountsExhaustedError(earliestAvailability());
};

const fallbackTitle = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "Neuer Chat";
  return flat.length <= 48 ? flat : `${flat.slice(0, 47).trimEnd()}…`;
};

export const initialTitle = fallbackTitle;

export const generateTitle = async (userText: string, assistantText: string): Promise<string> => {
  try {
    const response = await primaryClient().messages.create({
      model: config.titleModel,
      max_tokens: 1024,
      output_config: { effort: "low" },
      system:
        "Du erstellst kurze Titel für Chat-Unterhaltungen. Antworte ausschließlich mit dem Titel: höchstens sechs Wörter, in der Sprache der Unterhaltung, ohne Anführungszeichen und ohne Satzzeichen am Ende.",
      messages: [
        {
          role: "user",
          content: `Nutzernachricht:\n${userText.slice(0, 2000)}\n\nAntwort des Assistenten:\n${assistantText.slice(0, 2000)}\n\nTitel:`,
        },
      ],
    });
    const block = response.content.find((item) => item.type === "text");
    const raw = block && block.type === "text" ? block.text : "";
    const cleaned = raw
      .split("\n")[0]
      ?.replace(/^["„“'«»]+|["“”'«»]+$/g, "")
      .replace(/[.:;,!?]+$/g, "")
      .trim();
    if (!cleaned) return fallbackTitle(userText);
    return cleaned.length > 80 ? `${cleaned.slice(0, 79).trimEnd()}…` : cleaned;
  } catch {
    return fallbackTitle(userText);
  }
};

export const describeError = (error: unknown): { status: number; message: string } => {
  if (error instanceof AllAccountsExhaustedError) {
    const time = error.until
      ? new Intl.DateTimeFormat("de-DE", { timeZone: config.timezone, hour: "2-digit", minute: "2-digit" }).format(error.until)
      : null;
    return {
      status: 429,
      message: `Bei allen Konten ist das Limit erreicht${time ? `. Das nächste Konto ist ab ${time} Uhr wieder verfügbar` : ""}.`,
    };
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return { status: 502, message: "Der API-Schlüssel fehlt oder ist ungültig. Prüfe API_KEY." };
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return { status: 502, message: "Der API-Schlüssel hat keine Berechtigung für dieses Modell." };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { status: 429, message: "Das Anfragelimit des KI-Dienstes ist erreicht. Bitte gleich noch einmal versuchen." };
  }
  if (error instanceof Anthropic.BadRequestError) {
    return { status: 502, message: `Die Anfrage wurde von der API abgelehnt: ${error.message}` };
  }
  if (error instanceof Anthropic.NotFoundError) {
    return { status: 502, message: `Modell nicht gefunden: ${config.model}. Prüfe AI_MODEL.` };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { status: 502, message: "Keine Verbindung zum KI-Dienst. Prüfe die Internetverbindung des Servers." };
  }
  if (error instanceof Anthropic.APIError) {
    const overloaded = error.status === 529 || error.status === 503;
    return {
      status: 502,
      message: overloaded
        ? "Der KI-Dienst ist gerade überlastet. Bitte gleich noch einmal versuchen."
        : `API-Fehler (${error.status ?? "unbekannt"}): ${error.message}`,
    };
  }
  return { status: 500, message: "Unerwarteter Serverfehler." };
};

let windowCache: number | null = null;

export const getContextWindow = async (): Promise<number> => {
  if (windowCache) return windowCache;
  try {
    const info = await primaryClient().models.retrieve(config.model);
    if (info.max_input_tokens) {
      windowCache = info.max_input_tokens;
      return windowCache;
    }
  } catch {
    return config.model.startsWith("claude-haiku-4") ? 200000 : 1000000;
  }
  return config.model.startsWith("claude-haiku-4") ? 200000 : 1000000;
};
