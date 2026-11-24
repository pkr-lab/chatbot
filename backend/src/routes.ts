import express, { type Router } from "express";
import { config } from "./config.js";
import {
  counts,
  createChat,
  deleteChat,
  getChat,
  getSetting,
  insertMessage,
  listChats,
  listMessages,
  renameChat,
  searchChats,
  setPinned,
  setSetting,
  touchChat,
} from "./db.js";
import { dropTrailingAssistant, isBusy, runCompletion, stopChat } from "./chat-runner.js";
import { getContextWindow, initialTitle } from "./claude.js";
import { accountViews } from "./accounts.js";
import { buildHistory, buildMemoryDigest, getCustomInstructions, isCrossChatMemoryEnabled } from "./prompt.js";
import { authRequired } from "./auth.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TITLE = 120;
const MAX_INSTRUCTIONS = 4000;

const publicConfig = () => ({
  model: config.model,
  effort: config.effort,
  memoryDays: config.memoryDays,
  showThinking: config.showThinking,
  maxMessageChars: config.maxMessageChars,
  apiConfigured: config.hasCredentials,
  accountCount: config.accounts.length,
});

const contextOf = async (chatId: string) => {
  const messages = listMessages(chatId);
  const lastReply = [...messages].reverse().find((item) => item.role === "assistant" && item.input_tokens !== null);
  const history = buildHistory(chatId);
  const historyChars = history.reduce((sum, item) => sum + item.content.length, 0);
  const estimated = Math.round(historyChars / 3.5);
  const trailing = lastReply ? messages.filter((item) => item.id > lastReply.id).reduce((sum, item) => sum + item.content.length, 0) / 3.5 : 0;
  return {
    usedTokens: lastReply ? (lastReply.input_tokens ?? 0) + (lastReply.output_tokens ?? 0) + Math.round(trailing) : estimated,
    windowTokens: await getContextWindow(),
    historyMessages: history.length,
    totalMessages: messages.length,
    historyChars,
    maxHistoryChars: config.maxContextChars,
    memoryDays: config.memoryDays,
  };
};

export const apiRouter = (): Router => {
  const router = express.Router();

  router.get("/bootstrap", async (req, res) => {
    const chatId = typeof req.query.chat === "string" && UUID.test(req.query.chat) ? req.query.chat : null;
    const chat = chatId ? getChat(chatId) : undefined;
    res.json({
      authRequired: authRequired(),
      config: publicConfig(),
      settings: { customInstructions: getCustomInstructions(), crossChatMemory: isCrossChatMemoryEnabled() },
      chats: listChats(),
      usage: accountViews(),
      detail: chat ? { chat, messages: listMessages(chat.id), busy: isBusy(chat.id), context: await contextOf(chat.id) } : null,
    });
  });

  router.get("/usage", (_req, res) => {
    res.json(accountViews());
  });

  router.get("/chats/:id/context", async (req, res) => {
    if (!getChat(req.params.id)) {
      res.status(404).json({ error: "Chat nicht gefunden." });
      return;
    }
    res.json(await contextOf(req.params.id));
  });

  router.param("id", (_req, res, next, value: string) => {
    if (!UUID.test(value)) {
      res.status(400).json({ error: "Ungültige Chat-ID." });
      return;
    }
    next();
  });

  router.get("/config", (_req, res) => {
    res.json(publicConfig());
  });

  router.get("/settings", (_req, res) => {
    res.json({
      customInstructions: getCustomInstructions(),
      crossChatMemory: isCrossChatMemoryEnabled(),
    });
  });

  router.put("/settings", (req, res) => {
    const body = req.body ?? {};
    if (body.customInstructions !== undefined) {
      if (typeof body.customInstructions !== "string" || body.customInstructions.length > MAX_INSTRUCTIONS) {
        res.status(400).json({ error: `Eigene Anweisungen dürfen höchstens ${MAX_INSTRUCTIONS} Zeichen lang sein.` });
        return;
      }
      setSetting("customInstructions", body.customInstructions);
    }
    if (body.crossChatMemory !== undefined) {
      if (typeof body.crossChatMemory !== "boolean") {
        res.status(400).json({ error: "crossChatMemory muss ein Boolean sein." });
        return;
      }
      setSetting("crossChatMemory", String(body.crossChatMemory));
    }
    res.json({
      customInstructions: getCustomInstructions(),
      crossChatMemory: isCrossChatMemoryEnabled(),
    });
  });

  router.get("/memory", (_req, res) => {
    const digest = buildMemoryDigest(null);
    res.json({
      days: config.memoryDays,
      enabled: isCrossChatMemoryEnabled(),
      chats: digest.chats,
      messages: digest.messages,
      digest: digest.text,
      totals: counts(),
      hasStoredPreference: getSetting("crossChatMemory") !== undefined,
    });
  });

  router.get("/chats", (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    res.json(query ? searchChats(query) : listChats());
  });

  router.post("/chats", (_req, res) => {
    res.status(201).json(createChat("Neuer Chat"));
  });

  router.get("/chats/:id", (req, res) => {
    const chat = getChat(req.params.id);
    if (!chat) {
      res.status(404).json({ error: "Chat nicht gefunden." });
      return;
    }
    res.json({ chat, messages: listMessages(chat.id), busy: isBusy(chat.id) });
  });

  router.patch("/chats/:id", (req, res) => {
    const chat = getChat(req.params.id);
    if (!chat) {
      res.status(404).json({ error: "Chat nicht gefunden." });
      return;
    }
    const { title, pinned } = req.body ?? {};
    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim() || title.length > MAX_TITLE) {
        res.status(400).json({ error: "Ungültiger Titel." });
        return;
      }
      renameChat(chat.id, title.trim());
    }
    if (pinned !== undefined) {
      if (typeof pinned !== "boolean") {
        res.status(400).json({ error: "pinned muss ein Boolean sein." });
        return;
      }
      setPinned(chat.id, pinned);
    }
    res.json(getChat(chat.id));
  });

  router.delete("/chats/:id", (req, res) => {
    const chat = getChat(req.params.id);
    if (!chat) {
      res.status(404).json({ error: "Chat nicht gefunden." });
      return;
    }
    if (isBusy(chat.id)) {
      res.status(409).json({ error: "In diesem Chat läuft gerade eine Antwort." });
      return;
    }
    deleteChat(chat.id);
    res.status(204).end();
  });

  router.post("/chats/:id/messages", async (req, res) => {
    const chat = getChat(req.params.id);
    if (!chat) {
      res.status(404).json({ error: "Chat nicht gefunden." });
      return;
    }
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    if (!content.trim()) {
      res.status(400).json({ error: "Die Nachricht ist leer." });
      return;
    }
    if (content.length > config.maxMessageChars) {
      res.status(413).json({ error: `Die Nachricht ist zu lang (maximal ${config.maxMessageChars} Zeichen).` });
      return;
    }
    if (isBusy(chat.id)) {
      res.status(409).json({ error: "In diesem Chat läuft gerade eine Antwort." });
      return;
    }
    const isFirst = listMessages(chat.id).length === 0;
    const userMessage = insertMessage({ chat_id: chat.id, role: "user", content });
    if (isFirst) renameChat(chat.id, initialTitle(content));
    await runCompletion(res, { chatId: chat.id, userMessage });
  });

  router.post("/chats/:id/stop", (req, res) => {
    res.json({ stopped: stopChat(req.params.id) });
  });

  router.post("/chats/:id/regenerate", async (req, res) => {
    const chat = getChat(req.params.id);
    if (!chat) {
      res.status(404).json({ error: "Chat nicht gefunden." });
      return;
    }
    if (isBusy(chat.id)) {
      res.status(409).json({ error: "In diesem Chat läuft gerade eine Antwort." });
      return;
    }
    dropTrailingAssistant(chat.id);
    const messages = listMessages(chat.id);
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user") {
      res.status(400).json({ error: "Es gibt keine Nachricht, auf die geantwortet werden kann." });
      return;
    }
    touchChat(chat.id);
    await runCompletion(res, { chatId: chat.id });
  });

  return router;
};
