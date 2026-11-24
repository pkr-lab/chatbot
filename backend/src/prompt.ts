import { config } from "./config.js";
import { getUserSetting, lastMessage, memoryRows, messagesSince, type MemoryRow } from "./db.js";

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SystemBlock {
  type: "text";
  text: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const defaultSystemPrompt = [
  "Du bist Claude, ein KI-Assistent von Anthropic, und läufst in einer privaten Chat-Anwendung.",
  "Antworte in der Sprache, in der du angesprochen wirst (meist Deutsch).",
  "Nutze Markdown, wenn es die Lesbarkeit verbessert, und setze Code immer in Codeblöcke mit Sprachangabe.",
  "Sei präzise und ehrlich. Wenn dir Informationen fehlen, frage gezielt nach, statt zu raten.",
].join(" ");

const dayFormatter = new Intl.DateTimeFormat("de-DE", {
  timeZone: config.timezone,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const stampFormatter = new Intl.DateTimeFormat("de-DE", {
  timeZone: config.timezone,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const clip = (text: string, limit: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
};

const formatDays = (days: number): string => (Number.isInteger(days) ? String(days) : days.toFixed(1).replace(".", ","));

export const memoryCutoff = (now = Date.now()): number => now - config.memoryDays * DAY_MS;

export const getCustomInstructions = (userId: number): string => getUserSetting(userId, "customInstructions") ?? "";

export const isCrossChatMemoryEnabled = (userId: number): boolean => {
  const stored = getUserSetting(userId, "crossChatMemory");
  if (stored === undefined) return config.crossChatMemory;
  return stored === "true";
};

export interface MemoryDigest {
  text: string;
  chats: number;
  messages: number;
}

export const buildMemoryDigest = (userId: number, excludeChatId: string | null): MemoryDigest => {
  const rows = memoryRows(userId, memoryCutoff(), 800, excludeChatId);
  let budget = config.memoryDigestChars;
  const picked: MemoryRow[] = [];
  for (const row of rows) {
    const content = clip(row.content, row.role === "user" ? 800 : 500);
    const cost = content.length + 48;
    if (cost > budget) break;
    budget -= cost;
    picked.push({ ...row, content });
  }
  picked.reverse();

  const groups = new Map<string, MemoryRow[]>();
  for (const row of picked) {
    const list = groups.get(row.chat_id);
    if (list) list.push(row);
    else groups.set(row.chat_id, [row]);
  }

  if (groups.size === 0) return { text: "", chats: 0, messages: 0 };

  const sections: string[] = [];
  for (const list of groups.values()) {
    const first = list[0] as MemoryRow;
    const lines = list.map((row) => `${row.role === "user" ? "Nutzer" : "Claude"}: ${row.content}`);
    sections.push(`### „${first.chat_title}“ (${stampFormatter.format(first.created_at)})\n${lines.join("\n")}`);
  }

  const header = `Gedächtnis: Auszüge aus anderen Unterhaltungen der letzten ${formatDays(config.memoryDays)} Tage. Das ist Hintergrundwissen über die Person, mit der du schreibst. Nutze es nur, wenn es für die aktuelle Frage relevant ist, und erwähne es nicht ungefragt.`;
  return {
    text: `<memory>\n${header}\n\n${sections.join("\n\n")}\n</memory>`,
    chats: groups.size,
    messages: picked.length,
  };
};

export const buildSystem = (chatId: string, userId: number, now = Date.now()): SystemBlock[] => {
  const base = config.systemPrompt ?? defaultSystemPrompt;
  const blocks: SystemBlock[] = [
    {
      type: "text",
      text: `${base}\n\nHeutiges Datum: ${dayFormatter.format(now)} (Zeitzone ${config.timezone}).`,
    },
  ];

  const custom = getCustomInstructions(userId).trim();
  if (custom) {
    blocks.push({
      type: "text",
      text: `Eigene Anweisungen der Person, mit der du schreibst:\n${custom}`,
    });
  }

  if (isCrossChatMemoryEnabled(userId)) {
    const digest = buildMemoryDigest(userId, chatId);
    if (digest.text) blocks.push({ type: "text", text: digest.text });
  }

  return blocks;
};

export const buildHistory = (chatId: string, now = Date.now()): HistoryMessage[] => {
  const last = lastMessage(chatId);
  if (!last) return [];

  let rows = messagesSince(chatId, memoryCutoff(now));
  if (!rows.some((row) => row.id === last.id)) rows = [last];

  const selected: HistoryMessage[] = [];
  let total = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row) continue;
    total += row.content.length;
    if (total > config.maxContextChars && selected.length > 0) break;
    selected.unshift({ role: row.role, content: row.content });
  }

  while (selected.length > 0 && selected[0]?.role !== "user") selected.shift();
  return selected;
};
