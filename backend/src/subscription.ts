import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { getSetting, setSetting } from "./db.js";
import { seal, unseal } from "./secret.js";
import type { StreamInput, StreamResult } from "./llm.js";
import type { AccountView } from "./accounts.js";

const TOKEN_KEY = "claudeSubscriptionToken";
const TOKEN_PURPOSE = "claude-subscription-token";
const TOKEN_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,500}$/;
const WORK_DIR = path.join(process.env.TMPDIR ?? "/tmp", "plaudi-claude");
const NAME = "Claude-Abo";

export class SubscriptionError extends Error {
  constructor(
    public readonly kind: "not_connected" | "auth" | "limited" | "billing" | "failed",
    message: string,
    public readonly until: number | null = null,
  ) {
    super(message);
  }
}

interface ResultLike {
  subtype: string;
  is_error: boolean;
  result?: string;
  stop_reason?: string | null;
  api_error_status?: number | null;
  modelUsage?: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>;
}

interface PlanLimit {
  type: string;
  status: "allowed" | "allowed_warning" | "rejected";
  utilization: number | null;
  resetsAt: number | null;
}

const state: { until: number; limits: Map<string, PlanLimit>; failure: string | null } = {
  until: 0,
  limits: new Map(),
  failure: null,
};

export const getToken = (): string | null => {
  if (config.claudeToken) return config.claudeToken;
  const sealed = getSetting(TOKEN_KEY);
  return sealed ? unseal(TOKEN_PURPOSE, sealed) : null;
};

export const isConnected = (): boolean => getToken() !== null;

export const validTokenFormat = (token: string): boolean => TOKEN_PATTERN.test(token);

export const storeToken = (token: string): void => {
  setSetting(TOKEN_KEY, seal(TOKEN_PURPOSE, token));
  state.until = 0;
  state.failure = null;
};

export const clearToken = (): void => {
  setSetting(TOKEN_KEY, "");
  state.until = 0;
  state.failure = null;
  state.limits.clear();
};

export const tokenSource = (): "env" | "ui" | null => (config.claudeToken ? "env" : getSetting(TOKEN_KEY) ? "ui" : null);

const prepareWorkDir = (): string => {
  fs.mkdirSync(path.join(WORK_DIR, "config"), { recursive: true, mode: 0o700 });
  return WORK_DIR;
};

const buildPrompt = (messages: StreamInput["messages"]): string => {
  const last = messages[messages.length - 1];
  if (!last) return "";
  if (messages.length === 1) return last.content;
  const earlier = messages
    .slice(0, -1)
    .map((item) => `[${item.role === "user" ? "Person" : "Plaudi"}]\n${item.content}`)
    .join("\n\n");
  return `Bisheriger Gesprächsverlauf (nur als Kontext, nicht beantworten):\n\n${earlier}\n\n---\n\nAktuelle Nachricht der Person, darauf antwortest du jetzt:\n\n${last.content}`;
};

const recordLimit = (info: {
  status: "allowed" | "allowed_warning" | "rejected";
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number;
}): void => {
  const type = info.rateLimitType ?? "default";
  const resetsAt = info.resetsAt ? info.resetsAt * (info.resetsAt < 1e12 ? 1000 : 1) : null;
  state.limits.set(type, { type, status: info.status, utilization: info.utilization ?? null, resetsAt });
  if (info.status === "rejected" && resetsAt && resetsAt > Date.now()) state.until = Math.max(state.until, resetsAt);
};

const authMessage = "Die Claude-Anmeldung ist abgelaufen oder ungültig. Erzeuge mit „claude setup-token“ ein neues Token und trage es unter Einstellungen ein.";

const fromFailure = (status: number | null | undefined, text: string, assistantError: string | null): SubscriptionError => {
  if (assistantError === "authentication_failed" || assistantError === "oauth_org_not_allowed" || status === 401 || status === 403) {
    state.failure = authMessage;
    return new SubscriptionError("auth", authMessage);
  }
  if (assistantError === "rate_limit" || status === 429) {
    const until = Math.max(state.until, Date.now() + 60_000);
    state.until = until;
    return new SubscriptionError("limited", "Das Nutzungslimit des Claude-Abos ist erreicht.", until);
  }
  if (assistantError === "billing_error" || assistantError === "account_on_hold") {
    return new SubscriptionError("billing", "Das Claude-Konto ist gesperrt oder das Abo erlaubt diese Nutzung nicht.");
  }
  return new SubscriptionError("failed", text.slice(0, 300) || "Die Anfrage an Claude ist fehlgeschlagen.");
};

export const streamViaSubscription = async (input: StreamInput): Promise<StreamResult> => {
  const token = getToken();
  if (!token) throw new SubscriptionError("not_connected", "Claude ist noch nicht verbunden. Ein Administrator trägt das Token unter Einstellungen ein.");
  if (state.until > Date.now()) {
    throw new SubscriptionError("limited", "Das Nutzungslimit des Claude-Abos ist erreicht.", state.until);
  }

  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const dir = prepareWorkDir();
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (input.signal.aborted) abort();
  input.signal.addEventListener("abort", abort, { once: true });

  let text = "";
  let thinking = "";
  let assistantError: string | null = null;
  let stderr = "";

  try {
    const run = query({
      prompt: buildPrompt(input.messages),
      options: {
        model: config.model,
        systemPrompt: input.system.map((block) => block.text).join("\n\n"),
        tools: [],
        settingSources: [],
        strictMcpConfig: true,
        persistSession: false,
        includePartialMessages: true,
        maxTurns: 1,
        thinking: { type: "adaptive", display: config.showThinking ? "summarized" : "omitted" },
        effort: config.effort,
        cwd: dir,
        abortController: controller,
        stderr: (data: string) => {
          stderr = (stderr + data).slice(-2000);
        },
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: dir,
          CLAUDE_CONFIG_DIR: path.join(dir, "config"),
          CLAUDE_CODE_OAUTH_TOKEN: token,
          TZ: config.timezone,
          DISABLE_AUTOUPDATER: "1",
          DISABLE_TELEMETRY: "1",
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        },
      },
    });

    let final: ResultLike | null = null;

    for await (const message of run) {
      if (message.type === "stream_event") {
        if (message.parent_tool_use_id) continue;
        const event = message.event;
        if (event.type !== "content_block_delta") continue;
        if (event.delta.type === "text_delta") {
          text += event.delta.text;
          input.onText(event.delta.text);
        } else if (event.delta.type === "thinking_delta") {
          thinking += event.delta.thinking;
          input.onThinking(event.delta.thinking);
        }
      } else if (message.type === "assistant") {
        const error = (message as { error?: string }).error;
        if (error) assistantError = error;
      } else if (message.type === "rate_limit_event") {
        recordLimit(message.rate_limit_info);
      } else if (message.type === "result") {
        final = message;
      }
    }

    if (input.signal.aborted) throw new AbortedError();
    if (!final) throw fromFailure(null, stderr, assistantError);
    if (final.is_error || final.subtype !== "success") {
      throw fromFailure(final.api_error_status, final.result ?? stderr, assistantError);
    }

    state.failure = null;
    const usageEntries = Object.entries(final.modelUsage ?? {});
    const main = usageEntries.sort((a, b) => b[1].outputTokens - a[1].outputTokens)[0];
    return {
      text: text || final.result || "",
      thinking,
      stopReason: final.stop_reason ?? "end_turn",
      stopCategory: null,
      model: main?.[0] ?? config.model,
      inputTokens: main ? main[1].inputTokens + main[1].cacheReadInputTokens + main[1].cacheCreationInputTokens : 0,
      outputTokens: main?.[1].outputTokens ?? 0,
      fallbackUsed: false,
      account: NAME,
    };
  } catch (error) {
    if (error instanceof AbortedError || input.signal.aborted) throw new AbortedError({ text, thinking });
    if (error instanceof SubscriptionError) throw error;
    throw fromFailure(null, error instanceof Error ? `${error.message} ${stderr}` : stderr, assistantError);
  } finally {
    input.signal.removeEventListener("abort", abort);
  }
};

export class AbortedError extends Error {
  constructor(public readonly partial: { text: string; thinking: string } = { text: "", thinking: "" }) {
    super("aborted");
  }
}

export const verifyToken = async (token: string): Promise<{ ok: true } | { ok: false; message: string }> => {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const dir = prepareWorkDir();
  let stderr = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const run = query({
      prompt: "Antworte nur mit dem Wort ok.",
      options: {
        model: config.titleModel,
        systemPrompt: "Antworte so kurz wie möglich.",
        tools: [],
        settingSources: [],
        strictMcpConfig: true,
        persistSession: false,
        maxTurns: 1,
        cwd: dir,
        abortController: controller,
        stderr: (data: string) => {
          stderr = (stderr + data).slice(-2000);
        },
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: dir,
          CLAUDE_CONFIG_DIR: path.join(dir, "config"),
          CLAUDE_CODE_OAUTH_TOKEN: token,
          DISABLE_AUTOUPDATER: "1",
          DISABLE_TELEMETRY: "1",
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        },
      },
    });
    let assistantError: string | null = null;
    for await (const message of run) {
      if (message.type === "assistant") {
        const error = (message as { error?: string }).error;
        if (error) assistantError = error;
      } else if (message.type === "result") {
        if (message.is_error || message.subtype !== "success") {
          const failure = fromFailure("api_error_status" in message ? message.api_error_status : null, "result" in message ? message.result : stderr, assistantError);
          return { ok: false, message: failure.message };
        }
        return { ok: true };
      }
    }
    return { ok: false, message: "Keine Antwort von Claude erhalten." };
  } catch (error) {
    return { ok: false, message: controller.signal.aborted ? "Zeitüberschreitung bei der Prüfung." : `Prüfung fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannt"}` };
  } finally {
    clearTimeout(timer);
  }
};

export const subscriptionView = (now = Date.now()): AccountView => {
  const limits = [...state.limits.values()];
  const rejected = limits.find((item) => item.status === "rejected");
  const blocked = state.until > now;
  return {
    name: NAME,
    active: isConnected() && !blocked,
    status: !isConnected() || state.failure ? "invalid" : blocked || rejected ? "limited" : "ok",
    until: blocked ? state.until : null,
    limits: null,
  };
};

export const subscriptionLimits = (): PlanLimit[] => [...state.limits.values()];

export const subscriptionAvailableAt = (): number | null => (state.until > Date.now() ? state.until : null);
