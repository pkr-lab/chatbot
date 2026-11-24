import type { Chat } from "./types";

export interface ChatGroup {
  label: string;
  items: Chat[];
}

const startOfDay = (timestamp: number): number => {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export const groupChats = (chats: Chat[], now = Date.now()): ChatGroup[] => {
  const today = startOfDay(now);
  const day = 24 * 60 * 60 * 1000;
  const buckets: ChatGroup[] = [
    { label: "Angeheftet", items: [] },
    { label: "Heute", items: [] },
    { label: "Gestern", items: [] },
    { label: "Letzte 7 Tage", items: [] },
    { label: "Älter", items: [] },
  ];
  for (const chat of chats) {
    if (chat.pinned) buckets[0]?.items.push(chat);
    else if (chat.updated_at >= today) buckets[1]?.items.push(chat);
    else if (chat.updated_at >= today - day) buckets[2]?.items.push(chat);
    else if (chat.updated_at >= today - 6 * day) buckets[3]?.items.push(chat);
    else buckets[4]?.items.push(chat);
  }
  return buckets.filter((bucket) => bucket.items.length > 0);
};

export const formatTokens = (value: number | null): string => {
  if (value === null) return "";
  return value >= 1000 ? `${(value / 1000).toFixed(1).replace(".", ",")}k` : String(value);
};

export const formatDateTime = (timestamp: number): string =>
  new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(timestamp);

export const formatCompact = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(".", ",")}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1).replace(".", ",")}k`;
  return String(value);
};

export const formatClock = (timestamp: number): string =>
  new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(timestamp);

export const greeting = (now = new Date()): string => {
  const hour = now.getHours();
  if (hour < 5) return "Noch wach?";
  if (hour < 11) return "Guten Morgen";
  if (hour < 18) return "Guten Tag";
  return "Guten Abend";
};

export const prefersEnterForNewline = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  }
};
