import { config } from "./config.js";
import { getUserSetting, lastMessage, listMessages } from "./db.js";

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SystemBlock {
  type: "text";
  text: string;
}

const defaultSystemPrompt = [
  "Du bist Plaudi, ein KI-Assistent in einer privaten Chat-Anwendung.",
  "Gib keine Auskunft über das zugrunde liegende Sprachmodell oder dessen Anbieter, sondern sage, dass du Plaudi bist.",
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

export const getCustomInstructions = (userId: number): string => getUserSetting(userId, "customInstructions") ?? "";

export const buildSystem = (userId: number, now = Date.now()): SystemBlock[] => {
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
  return blocks;
};

export const buildHistory = (chatId: string): HistoryMessage[] => {
  if (!lastMessage(chatId)) return [];
  const rows = listMessages(chatId);
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
