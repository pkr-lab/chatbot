import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { config } from "./config.js";

export interface UserRow {
  id: number;
  email: string;
  role: "admin" | "user";
  created_at: number;
  last_login: number | null;
}

export interface SessionRow {
  id: string;
  user_id: number;
  created_at: number;
  last_seen: number;
  expires_at: number;
}

export interface CodeRow {
  email: string;
  code_hash: string;
  expires_at: number;
  attempts: number;
  created_at: number;
}

export interface ChatRow {
  id: string;
  user_id: number | null;
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
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at INTEGER NOT NULL,
    last_login INTEGER
  );
  CREATE TABLE IF NOT EXISTS login_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );
`);

const chatColumns = db.prepare<[], { name: string }>("PRAGMA table_info(chats)").all();
if (!chatColumns.some((column) => column.name === "user_id")) {
  db.exec("ALTER TABLE chats ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
}
db.exec("CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, updated_at)");

const stmts = {
  listChats: db.prepare<[number], ChatRow>("SELECT * FROM chats WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC"),
  getChat: db.prepare<[string], ChatRow>("SELECT * FROM chats WHERE id = ?"),
  insertChat: db.prepare("INSERT INTO chats (id, user_id, title, pinned, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)"),
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
  memoryRows: db.prepare<[number, number, number], MemoryRow>(
    `SELECT m.chat_id AS chat_id, c.title AS chat_title, m.role AS role, m.content AS content, m.created_at AS created_at
     FROM messages m JOIN chats c ON c.id = m.chat_id
     WHERE c.user_id = ? AND m.created_at >= ? ORDER BY m.id DESC LIMIT ?`,
  ),
  memoryRowsExcluding: db.prepare<[number, string, number, number], MemoryRow>(
    `SELECT m.chat_id AS chat_id, c.title AS chat_title, m.role AS role, m.content AS content, m.created_at AS created_at
     FROM messages m JOIN chats c ON c.id = m.chat_id
     WHERE c.user_id = ? AND m.chat_id != ? AND m.created_at >= ? ORDER BY m.id DESC LIMIT ?`,
  ),
  search: db.prepare<[number, string, string], ChatRow>(
    `SELECT DISTINCT c.* FROM chats c
     LEFT JOIN messages m ON m.chat_id = c.id
     WHERE c.user_id = ? AND (c.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\')
     ORDER BY c.updated_at DESC LIMIT 50`,
  ),
  getSetting: db.prepare<[string], { value: string }>("SELECT value FROM settings WHERE key = ?"),
  setSetting: db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ),
  messageCount: db.prepare<[number], { count: number }>(
    "SELECT COUNT(*) AS count FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE user_id = ?)",
  ),
  chatCount: db.prepare<[number], { count: number }>("SELECT COUNT(*) AS count FROM chats WHERE user_id = ?"),
  getUserSetting: db.prepare<[number, string], { value: string }>("SELECT value FROM user_settings WHERE user_id = ? AND key = ?"),
  setUserSetting: db.prepare(
    "INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
  ),
  userByEmail: db.prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?"),
  userById: db.prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?"),
  listUsers: db.prepare<[], UserRow>("SELECT * FROM users ORDER BY created_at ASC"),
  insertUser: db.prepare("INSERT INTO users (email, role, created_at) VALUES (?, ?, ?)"),
  deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
  setRole: db.prepare("UPDATE users SET role = ? WHERE id = ?"),
  touchLogin: db.prepare("UPDATE users SET last_login = ? WHERE id = ?"),
  adminCount: db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'"),
  userCount: db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM users"),
  getCode: db.prepare<[string], CodeRow>("SELECT * FROM login_codes WHERE email = ?"),
  putCode: db.prepare(
    `INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`,
  ),
  bumpAttempts: db.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?"),
  deleteCode: db.prepare("DELETE FROM login_codes WHERE email = ?"),
  purgeCodes: db.prepare("DELETE FROM login_codes WHERE expires_at < ?"),
  insertSession: db.prepare(
    "INSERT INTO sessions (id, user_id, created_at, last_seen, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ),
  sessionWithUser: db.prepare<[string], SessionRow & { email: string; role: "admin" | "user" }>(
    `SELECT s.id AS id, s.user_id AS user_id, s.created_at AS created_at, s.last_seen AS last_seen, s.expires_at AS expires_at,
            u.email AS email, u.role AS role
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
  ),
  touchSession: db.prepare("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?"),
  deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
  deleteUserSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
  purgeSessions: db.prepare("DELETE FROM sessions WHERE expires_at < ?"),
  adoptChats: db.prepare("UPDATE chats SET user_id = ? WHERE user_id IS NULL"),
};

export const listChats = (userId: number): ChatRow[] => stmts.listChats.all(userId);

export const getChat = (id: string): ChatRow | undefined => stmts.getChat.get(id);

export const getOwnedChat = (id: string, userId: number): ChatRow | undefined => {
  const chat = stmts.getChat.get(id);
  return chat && chat.user_id === userId ? chat : undefined;
};

export const createChat = (userId: number, title: string): ChatRow => {
  const id = crypto.randomUUID();
  const now = Date.now();
  stmts.insertChat.run(id, userId, title, now, now);
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

export const memoryRows = (userId: number, since: number, limit: number, excludeChatId: string | null): MemoryRow[] =>
  excludeChatId === null ? stmts.memoryRows.all(userId, since, limit) : stmts.memoryRowsExcluding.all(userId, excludeChatId, since, limit);

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export const searchChats = (userId: number, query: string): ChatRow[] => {
  const pattern = `%${escapeLike(query)}%`;
  return stmts.search.all(userId, pattern, pattern);
};

export const getSetting = (key: string): string | undefined => stmts.getSetting.get(key)?.value;

export const setSetting = (key: string, value: string): void => {
  stmts.setSetting.run(key, value);
};

export const counts = (userId: number): { chats: number; messages: number } => ({
  chats: stmts.chatCount.get(userId)?.count ?? 0,
  messages: stmts.messageCount.get(userId)?.count ?? 0,
});

export const getUserSetting = (userId: number, key: string): string | undefined => stmts.getUserSetting.get(userId, key)?.value;

export const setUserSetting = (userId: number, key: string, value: string): void => {
  stmts.setUserSetting.run(userId, key, value);
};

export const findUserByEmail = (email: string): UserRow | undefined => stmts.userByEmail.get(email);

export const findUserById = (id: number): UserRow | undefined => stmts.userById.get(id);

export const listUsers = (): UserRow[] => stmts.listUsers.all();

export const createUser = (email: string, role: "admin" | "user"): UserRow => {
  stmts.insertUser.run(email, role, Date.now());
  return stmts.userByEmail.get(email) as UserRow;
};

export const removeUser = (id: number): void => {
  stmts.deleteUser.run(id);
};

export const updateRole = (id: number, role: "admin" | "user"): void => {
  stmts.setRole.run(role, id);
};

export const markLogin = (id: number): void => {
  stmts.touchLogin.run(Date.now(), id);
};

export const adminCount = (): number => stmts.adminCount.get()?.count ?? 0;

export const userCount = (): number => stmts.userCount.get()?.count ?? 0;

export const getCode = (email: string): CodeRow | undefined => stmts.getCode.get(email);

export const putCode = (email: string, hash: string, expiresAt: number): void => {
  stmts.putCode.run(email, hash, expiresAt, Date.now());
};

export const bumpCodeAttempts = (email: string): void => {
  stmts.bumpAttempts.run(email);
};

export const deleteCode = (email: string): void => {
  stmts.deleteCode.run(email);
};

export const insertSession = (id: string, userId: number, expiresAt: number, ip: string | null, agent: string | null): void => {
  const now = Date.now();
  stmts.insertSession.run(id, userId, now, now, expiresAt, ip, agent ? agent.slice(0, 200) : null);
};

export const findSession = (id: string) => stmts.sessionWithUser.get(id);

export const touchSession = (id: string, expiresAt: number): void => {
  stmts.touchSession.run(Date.now(), expiresAt, id);
};

export const deleteSession = (id: string): void => {
  stmts.deleteSession.run(id);
};

export const deleteUserSessions = (userId: number): void => {
  stmts.deleteUserSessions.run(userId);
};

export const purgeExpired = (): void => {
  const now = Date.now();
  stmts.purgeCodes.run(now);
  stmts.purgeSessions.run(now);
};

export const adoptOrphans = (userId: number): void => {
  stmts.adoptChats.run(userId);
  for (const key of ["customInstructions", "crossChatMemory"]) {
    const legacy = stmts.getSetting.get(key)?.value;
    if (legacy !== undefined && stmts.getUserSetting.get(userId, key) === undefined) stmts.setUserSetting.run(userId, key, legacy);
  }
};

export const closeDb = (): void => {
  db.close();
};
