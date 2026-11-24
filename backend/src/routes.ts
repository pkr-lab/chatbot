import express, { type Response, type Router } from "express";
import { accountViews } from "./accounts.js";
import { currentUser } from "./auth.js";
import { dropTrailingAssistant, isBusy, runCompletion, stopChat } from "./chat-runner.js";
import { getContextWindow, initialTitle } from "./llm.js";
import { isConnected } from "./subscription.js";
import { config } from "./config.js";
import {
  createChat,
  deleteChat,
  getOwnedChat,
  insertMessage,
  listChats,
  listMessages,
  renameChat,
  searchChats,
  setPinned,
  setUserSetting,
  touchChat,
  type ChatRow,
} from "./db.js";
import { buildHistory, getCustomInstructions } from "./prompt.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TITLE = 120;
const MAX_INSTRUCTIONS = 4000;

const publicConfig = () => ({
  showThinking: config.showThinking,
  maxMessageChars: config.maxMessageChars,
  apiConfigured: config.backend === "subscription" ? isConnected() : config.hasCredentials,
  backend: config.backend,
  accountCount: config.accounts.length,
});

const usageFor = (res: Response) => (currentUser(res).role === "admin" ? accountViews() : []);

const settingsFor = (userId: number) => ({
  customInstructions: getCustomInstructions(userId),
});

const contextOf = async (chatId: string) => {
  const messages = listMessages(chatId);
  const lastReply = [...messages].reverse().find((item) => item.role === "assistant" && item.input_tokens !== null);
  const history = buildHistory(chatId);
  const historyChars = history.reduce((sum, item) => sum + item.content.length, 0);
  const estimated = Math.round(historyChars / 3.5);
  const trailing = lastReply
    ? messages.filter((item) => item.id > lastReply.id).reduce((sum, item) => sum + item.content.length, 0) / 3.5
    : 0;
  return {
    usedTokens: lastReply ? (lastReply.input_tokens ?? 0) + (lastReply.output_tokens ?? 0) + Math.round(trailing) : estimated,
    windowTokens: await getContextWindow(),
    historyMessages: history.length,
    totalMessages: messages.length,
    historyChars,
    maxHistoryChars: config.maxContextChars,
  };
};

const ownChat = (id: string, res: Response): ChatRow | undefined => getOwnedChat(id, currentUser(res).id);

export const apiRouter = (): Router => {
  const router = express.Router();

  router.param("id", (_req, res, next, value: string) => {
    if (!UUID.test(value)) {
      res.status(400).json({ error: "Ungültige Chat-ID." });
      return;
    }
    next();
  });

  router.get("/bootstrap", async (req, res) => {
    const user = currentUser(res);
    const requested = typeof req.query.chat === "string" && UUID.test(req.query.chat) ? req.query.chat : null;
    const chat = requested ? getOwnedChat(requested, user.id) : undefined;
    res.json({
      user: { id: user.id, email: user.email, role: user.role },
      config: publicConfig(),
      settings: settingsFor(user.id),
      chats: listChats(user.id),
      usage: usageFor(res),
      detail: chat ? { chat, messages: listMessages(chat.id), busy: isBusy(chat.id), context: await contextOf(chat.id) } : null,
    });
  });

  router.get("/usage", (_req, res) => {
    res.json(usageFor(res));
  });

  router.get("/config", (_req, res) => {
    res.json(publicConfig());
  });

  router.get("/settings", (_req, res) => {
    res.json(settingsFor(currentUser(res).id));
  });

  router.put("/settings", (req, res) => {
    const userId = currentUser(res).id;
    const body = req.body ?? {};
    if (body.customInstructions !== undefined) {
      if (typeof body.customInstructions !== "string" || body.customInstructions.length > MAX_INSTRUCTIONS) {
        res.status(400).json({ error: `Eigene Anweisungen dürfen höchstens ${MAX_INSTRUCTIONS} Zeichen lang sein.` });
        return;
      }
      setUserSetting(userId, "customInstructions", body.customInstructions);
    }
    res.json(settingsFor(userId));
  });

  router.get("/chats", (req, res) => {
    const userId = currentUser(res).id;
    const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    res.json(query ? searchChats(userId, query) : listChats(userId));
  });

  router.post("/chats", (_req, res) => {
    res.status(201).json(createChat(currentUser(res).id, "Neuer Chat"));
  });

  router.get("/chats/:id", (req, res) => {
    const chat = ownChat(req.params.id, res);
    if (!chat) {
      res.status(404).json({ error: "Chat nicht gefunden." });
      return;
    }
    res.json({ chat, messages: listMessages(chat.id), busy: isBusy(chat.id) });
  });

  router.get("/chats/:id/context", async (req, res) => {
    const chat = ownChat(req.params.id, res);
    if (!chat) {
      res.status(404).json({ error: "Chat nicht gefunden." });
      return;
    }
    res.json(await contextOf(chat.id));
  });

  router.patch("/chats/:id", (req, res) => {
    const chat = ownChat(req.params.id, res);
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
    res.json(ownChat(chat.id, res));
  });

  router.delete("/chats/:id", (req, res) => {
    const chat = ownChat(req.params.id, res);
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
    const chat = ownChat(req.params.id, res);
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
    await runCompletion(res, { chatId: chat.id, userId: currentUser(res).id, userMessage });
  });

  router.post("/chats/:id/stop", (req, res) => {
    const chat = ownChat(req.params.id, res);
    if (!chat) {
      res.status(404).json({ error: "Chat nicht gefunden." });
      return;
    }
    res.json({ stopped: stopChat(chat.id) });
  });

  router.post("/chats/:id/regenerate", async (req, res) => {
    const chat = ownChat(req.params.id, res);
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
    await runCompletion(res, { chatId: chat.id, userId: currentUser(res).id });
  });

  return router;
};
