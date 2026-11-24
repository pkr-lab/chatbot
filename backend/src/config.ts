import path from "node:path";

const read = (key: string): string | undefined => {
  const value = process.env[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const readInt = (key: string, fallback: number): number => {
  const raw = read(key);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readFloat = (key: string, fallback: number): number => {
  const raw = read(key);
  if (raw === undefined) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readBool = (key: string, fallback: boolean): boolean => {
  const raw = read(key)?.toLowerCase();
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "ja", "on"].includes(raw);
};

const efforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof efforts)[number];

const readEffort = (): Effort => {
  const raw = read("CLAUDE_EFFORT")?.toLowerCase();
  return (efforts as readonly string[]).includes(raw ?? "") ? (raw as Effort) : "medium";
};

const readTimezone = (): string => {
  const candidate = read("TZ") ?? "Europe/Berlin";
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: candidate });
    return candidate;
  } catch {
    return "UTC";
  }
};

const readTrustProxy = (): number | false => {
  const raw = read("TRUST_PROXY")?.toLowerCase();
  if (raw === undefined || raw === "false" || raw === "0") return false;
  if (raw === "true") return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : false;
};

export interface AccountConfig {
  name: string;
  apiKey?: string;
  authToken?: string;
}

const readAccounts = (): AccountConfig[] => {
  const raw = [read("ANTHROPIC_API_KEYS"), read("ANTHROPIC_API_KEY")].filter(Boolean).join(",");
  const accounts: AccountConfig[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const item = part.trim();
    if (!item) continue;
    const eq = item.indexOf("=");
    const hasLabel = eq > 0 && !item.startsWith("sk-");
    const apiKey = hasLabel ? item.slice(eq + 1).trim() : item;
    if (accounts.some((entry) => entry.apiKey === apiKey)) continue;
    accounts.push({ name: hasLabel ? item.slice(0, eq).trim() : `Konto ${accounts.length + 1}`, apiKey });
  }
  const token = read("ANTHROPIC_AUTH_TOKEN");
  if (token) accounts.push({ name: `Konto ${accounts.length + 1}`, authToken: token });
  return accounts;
};

const model = read("CLAUDE_MODEL") ?? "claude-opus-5-5";
const fallbackModels = ["claude-opus-5-5", "claude-opus-5", "claude-fable-5", "claude-sonnet-5-5"];
const fallbackSetting = read("ENABLE_FALLBACK")?.toLowerCase() ?? "auto";

export const config = {
  port: readInt("PORT", 3000),
  dataDir: path.resolve(read("DATA_DIR") ?? "./data"),
  publicDir: path.resolve(read("PUBLIC_DIR") ?? "./public"),
  accounts: readAccounts(),
  hasCredentials: readAccounts().length > 0,
  model,
  effort: readEffort(),
  maxTokens: readInt("MAX_TOKENS", 64000),
  titleModel: read("TITLE_MODEL") ?? "claude-haiku-5-5",
  enableFallback:
    fallbackSetting === "auto"
      ? fallbackModels.some((prefix) => model.startsWith(prefix))
      : ["1", "true", "yes", "on"].includes(fallbackSetting),
  memoryDays: readFloat("MEMORY_DAYS", 3),
  crossChatMemory: readBool("CROSS_CHAT_MEMORY", true),
  maxContextChars: readInt("MAX_CONTEXT_CHARS", 400000),
  memoryDigestChars: readInt("MEMORY_DIGEST_CHARS", 12000),
  showThinking: readBool("SHOW_THINKING", true),
  adminEmail: read("ADMIN_EMAIL")?.toLowerCase(),
  sessionSecret: read("SESSION_SECRET"),
  sessionIdleDays: readFloat("SESSION_IDLE_DAYS", 7),
  sessionMaxDays: readFloat("SESSION_MAX_DAYS", 30),
  codeTtlMinutes: readFloat("CODE_TTL_MINUTES", 10),
  codeResendSeconds: readFloat("CODE_RESEND_SECONDS", 30),
  codeRequestsPerHour: readInt("CODE_REQUESTS_PER_HOUR", 5),
  mail: {
    transport: read("MAIL_TRANSPORT")?.toLowerCase(),
    from: read("MAIL_FROM") ?? "Plaudi <no-reply@localhost>",
    webhookUrl: read("MAIL_WEBHOOK_URL"),
    webhookToken: read("MAIL_WEBHOOK_TOKEN"),
    smtpHost: read("SMTP_HOST"),
    smtpPort: readInt("SMTP_PORT", 587),
    smtpUser: read("SMTP_USER"),
    smtpPass: read("SMTP_PASS"),
    smtpSecure: readBool("SMTP_SECURE", false),
  },
  secureCookies: readBool("COOKIE_SECURE", false),
  trustProxy: readTrustProxy(),
  timezone: readTimezone(),
  systemPrompt: read("SYSTEM_PROMPT"),
  maxMessageChars: readInt("MAX_MESSAGE_CHARS", 100000),
} as const;
