import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { config } from "./config.js";

export interface ChatRow {
  id: string;
  title: string;
  pinned: number;
  created_at: number;
  updated_at: number;
}

export type Role = "user" | "assistant";

export interface MessageRow {
  id: number;
  chat_id: string;
  role: Role;
  content: string;
  thinking: string | null;
  stop_reason: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: number;
}

export interface MemoryRow {
  chat_id: string;
  chat_title: string;
  role: Role;
  content: string;
  created_at: number;
}

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(path.join(config.dataDir, "chatbot.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    thinking TEXT,
    stop_reason TEXT,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const stmts = {
  listChats: db.prepare<[], ChatRow>("SELECT * FROM chats ORDER BY pinned DESC, updated_at DESC"),
  getChat: db.prepare<[string], ChatRow>("SELECT * FROM chats WHERE id = ?"),
  insertChat: db.prepare("INSERT INTO chats (id, title, pinned, created_at, updated_at) VALUES (?, ?, 0, ?, ?)"),
  renameChat: db.prepare("UPDATE chats SET title = ? WHERE id = ?"),
  pinChat: db.prepare("UPDATE chats SET pinned = ? WHERE id = ?"),
  touchChat: db.prepare("UPDATE chats SET updated_at = ? WHERE id = ?"),
  deleteChat: db.prepare("DELETE FROM chats WHERE id = ?"),
  listMessages: db.prepare<[string], MessageRow>("SELECT * FROM messages WHERE chat_id = ? ORDER BY id ASC"),
  messagesSince: db.prepare<[string, number], MessageRow>(
    "SELECT * FROM messages WHERE chat_id = ? AND created_at >= ? ORDER BY id ASC",
  ),
  lastMessage: db.prepare<[string], MessageRow>("SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1"),
  getMessage: db.prepare<[number], MessageRow>("SELECT * FROM messages WHERE id = ?"),
  countChatMessages: db.prepare<[string], { count: number }>("SELECT COUNT(*) AS count FROM messages WHERE chat_id = ?"),
  insertMessage: db.prepare(
    `INSERT INTO messages (chat_id, role, content, thinking, stop_reason, model, input_tokens, output_tokens, created_at)
     VALUES (@chat_id, @role, @content, @thinking, @stop_reason, @model, @input_tokens, @output_tokens, @created_at)`,
  ),
  deleteMessage: db.prepare("DELETE FROM messages WHERE id = ?"),
  memoryRows: db.prepare<[number, number], MemoryRow>(
    `SELECT m.chat_id AS chat_id, c.title AS chat_title, m.role AS role, m.content AS content, m.created_at AS created_at
     FROM messages m JOIN chats c ON c.id = m.chat_id
     WHERE m.created_at >= ? ORDER BY m.id DESC LIMIT ?`,
  ),
  memoryRowsExcluding: db.prepare<[string, number, number], MemoryRow>(
    `SELECT m.chat_id AS chat_id, c.title AS chat_title, m.role AS role, m.content AS content, m.created_at AS created_at
     FROM messages m JOIN chats c ON c.id = m.chat_id
     WHERE m.chat_id != ? AND m.created_at >= ? ORDER BY m.id DESC LIMIT ?`,
  ),
  search: db.prepare<[string, string], ChatRow>(
    `SELECT DISTINCT c.* FROM chats c
     LEFT JOIN messages m ON m.chat_id = c.id
     WHERE c.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\'
     ORDER BY c.updated_at DESC LIMIT 50`,
  ),
  getSetting: db.prepare<[string], { value: string }>("SELECT value FROM settings WHERE key = ?"),
  setSetting: db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ),
  messageCount: db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM messages"),
  chatCount: db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM chats"),
};

export const listChats = (): ChatRow[] => stmts.listChats.all();

export const getChat = (id: string): ChatRow | undefined => stmts.getChat.get(id);

export const createChat = (title: string): ChatRow => {
  const id = crypto.randomUUID();
  const now = Date.now();
  stmts.insertChat.run(id, title, now, now);
  return getChat(id) as ChatRow;
};

export const renameChat = (id: string, title: string): void => {
  stmts.renameChat.run(title, id);
};

export const setPinned = (id: string, pinned: boolean): void => {
  stmts.pinChat.run(pinned ? 1 : 0, id);
};

export const touchChat = (id: string): void => {
  stmts.touchChat.run(Date.now(), id);
};

export const deleteChat = (id: string): void => {
  stmts.deleteChat.run(id);
};

export const listMessages = (chatId: string): MessageRow[] => stmts.listMessages.all(chatId);

export const messagesSince = (chatId: string, since: number): MessageRow[] => stmts.messagesSince.all(chatId, since);

export const countChatMessages = (chatId: string): number => stmts.countChatMessages.get(chatId)?.count ?? 0;

export const lastMessage = (chatId: string): MessageRow | undefined => stmts.lastMessage.get(chatId);

export const deleteMessage = (id: number): void => {
  stmts.deleteMessage.run(id);
};

export interface NewMessage {
  chat_id: string;
  role: Role;
  content: string;
  thinking?: string | null;
  stop_reason?: string | null;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
}

export const insertMessage = (input: NewMessage): MessageRow => {
  const result = stmts.insertMessage.run({
    chat_id: input.chat_id,
    role: input.role,
    content: input.content,
    thinking: input.thinking ?? null,
    stop_reason: input.stop_reason ?? null,
    model: input.model ?? null,
    input_tokens: input.input_tokens ?? null,
    output_tokens: input.output_tokens ?? null,
    created_at: Date.now(),
  });
  stmts.touchChat.run(Date.now(), input.chat_id);
  return stmts.getMessage.get(Number(result.lastInsertRowid)) as MessageRow;
};

export const memoryRows = (since: number, limit: number, excludeChatId: string | null): MemoryRow[] =>
  excludeChatId === null ? stmts.memoryRows.all(since, limit) : stmts.memoryRowsExcluding.all(excludeChatId, since, limit);

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export const searchChats = (query: string): ChatRow[] => {
  const pattern = `%${escapeLike(query)}%`;
  return stmts.search.all(pattern, pattern);
};

export const getSetting = (key: string): string | undefined => stmts.getSetting.get(key)?.value;

export const setSetting = (key: string, value: string): void => {
  stmts.setSetting.run(key, value);
};

export const counts = (): { chats: number; messages: number } => ({
  chats: stmts.chatCount.get()?.count ?? 0,
  messages: stmts.messageCount.get()?.count ?? 0,
});

export const closeDb = (): void => {
  db.close();
};
