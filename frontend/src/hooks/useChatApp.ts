import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, setUnauthorizedHandler, streamRequest } from "../api";
import type { AccountUsage, AppConfig, Bootstrap, Chat, ChatContext, ChatError, Message, Settings, StreamState } from "../types";

const NEW_CHAT_KEY = "new";
const POLL_MS = 1500;
const MAX_POLL_FAILURES = 5;

const idFromPath = (): string | null => {
  const match = /^\/c\/([0-9a-f-]{36})\/?$/i.exec(window.location.pathname);
  return match?.[1] ?? null;
};

const sortChats = (chats: Chat[]): Chat[] =>
  [...chats].sort((a, b) => b.pinned - a.pinned || b.updated_at - a.updated_at);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "Unbekannter Fehler.";

export interface ChatApp {
  chats: Chat[];
  visibleChats: Chat[];
  searching: boolean;
  query: string;
  setQuery: (query: string) => void;
  activeId: string | null;
  activeChat: Chat | undefined;
  messages: Message[];
  loading: boolean;
  stream: StreamState | null;
  streamingChatId: string | null;
  error: ChatError | null;
  remoteBusy: boolean;
  config: AppConfig;
  settings: Settings;
  usage: AccountUsage[];
  context: ChatContext | null;
  notice: string | null;
  dismissNotice: () => void;
  setSettings: (settings: Settings) => void;
  openChat: (id: string | null) => void;
  send: (text: string) => Promise<boolean>;
  regenerate: () => Promise<void>;
  stop: () => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  pin: (id: string, pinned: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  dismissError: () => void;
}

export const useChatApp = (initial: Bootstrap, onUnauthorized: () => void): ChatApp => {
  const [chats, setChats] = useState<Chat[]>(() => sortChats(initial.chats));
  const [activeId, setActiveId] = useState<string | null>(() => initial.detail?.chat.id ?? null);
  const [messages, setMessages] = useState<Message[]>(() => initial.detail?.messages ?? []);
  const [loading, setLoading] = useState(false);
  const [stream, setStream] = useState<StreamState | null>(null);
  const [error, setError] = useState<ChatError | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(() => initial.detail?.busy ?? false);
  const [config] = useState<AppConfig>(initial.config);
  const [settings, setSettings] = useState<Settings>(initial.settings);
  const [usage, setUsage] = useState<AccountUsage[]>(initial.usage);
  const [context, setContext] = useState<ChatContext | null>(initial.detail?.context ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Chat[] | null>(null);

  const activeRef = useRef<string | null>(activeId);

  const refreshMeters = useCallback((chatId: string) => {
    api.usage().then(setUsage).catch(() => undefined);
    api
      .context(chatId)
      .then((value) => {
        if (activeRef.current === chatId) setContext(value);
      })
      .catch(() => undefined);
  }, []);
  const pending = useRef({ text: "", thinking: "", frame: 0 });

  useEffect(() => {
    setUnauthorizedHandler(onUnauthorized);
    return () => setUnauthorizedHandler(null);
  }, [onUnauthorized]);

  const upsertChat = useCallback((chat: Chat) => {
    setChats((previous) =>
      sortChats(previous.some((item) => item.id === chat.id) ? previous.map((item) => (item.id === chat.id ? chat : item)) : [chat, ...previous]),
    );
  }, []);

  const openChat = useCallback((id: string | null) => {
    activeRef.current = id;
    setActiveId(id);
    setError(null);
    setMessages([]);
    setRemoteBusy(false);
    setContext(null);
    setNotice(null);
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.context(id).then((value) => {
      if (activeRef.current === id) setContext(value);
    }, () => undefined);
    api
      .getChat(id)
      .then((detail) => {
        if (activeRef.current !== id) return;
        setMessages(detail.messages);
        setRemoteBusy(detail.busy);
      })
      .catch((failure: unknown) => {
        if (activeRef.current !== id) return;
        if (failure instanceof ApiError && failure.status === 404) {
          window.history.replaceState(null, "", "/");
          activeRef.current = null;
          setActiveId(null);
          return;
        }
        setError({ chatId: id, message: messageOf(failure) });
      })
      .finally(() => {
        if (activeRef.current === id) setLoading(false);
      });
  }, []);

  const navigate = useCallback(
    (id: string | null) => {
      const target = id ? `/c/${id}` : "/";
      if (window.location.pathname !== target) window.history.pushState(null, "", target);
      openChat(id);
    },
    [openChat],
  );

  useEffect(() => {
    if (idFromPath() && !initial.detail) window.history.replaceState(null, "", "/");
    const onPop = (): void => openChat(idFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [openChat, initial.detail]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .listChats(trimmed)
        .then(setSearchResults)
        .catch(() => setSearchResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const streamingChatId = stream?.chatId ?? null;

  useEffect(() => {
    if (!remoteBusy || !activeId || streamingChatId === activeId) return;
    let failures = 0;
    const timer = window.setInterval(() => {
      api
        .getChat(activeId)
        .then((detail) => {
          failures = 0;
          if (activeRef.current !== activeId) return;
          setMessages(detail.messages);
          if (!detail.busy) {
            setRemoteBusy(false);
            upsertChat(detail.chat);
            refreshMeters(activeId);
          }
        })
        .catch(() => {
          failures += 1;
          if (failures >= MAX_POLL_FAILURES) {
            setRemoteBusy(false);
            setError({ chatId: activeId, message: "Die Verbindung zum Server ist unterbrochen." });
          }
        });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [remoteBusy, activeId, streamingChatId, upsertChat, refreshMeters]);

  const activeChat = useMemo(() => chats.find((chat) => chat.id === activeId), [chats, activeId]);

  useEffect(() => {
    document.title = activeChat && activeChat.title !== "Neuer Chat" ? `${activeChat.title} · Plaudi` : "Plaudi";
  }, [activeChat]);

  const flushPending = useCallback(() => {
    const current = pending.current;
    current.frame = 0;
    if (!current.text && !current.thinking) return;
    const text = current.text;
    const thinking = current.thinking;
    current.text = "";
    current.thinking = "";
    setStream((state) => (state ? { ...state, text: state.text + text, thinking: state.thinking + thinking } : state));
  }, []);

  const queueFlush = useCallback(() => {
    if (!pending.current.frame) pending.current.frame = window.requestAnimationFrame(flushPending);
  }, [flushPending]);

  const run = useCallback(
    async (chatId: string, path: string, body?: unknown, optimisticId?: number): Promise<void> => {
      setError(null);
      setNotice(null);
      setStream({ chatId, text: "", thinking: "" });
      const visible = (): boolean => activeRef.current === chatId;
      let terminal = false;
      let failed = false;
      try {
        terminal = await streamRequest(path, body, {
          onUser: (message) => {
            if (visible()) setMessages((previous) => previous.map((item) => (item.id === optimisticId ? message : item)));
          },
          onDelta: (text) => {
            pending.current.text += text;
            queueFlush();
          },
          onThinking: (text) => {
            pending.current.thinking += text;
            queueFlush();
          },
          onSwitch: ({ from, to }) => setNotice(`${from} hat das Limit erreicht. Es wird mit ${to} weitergemacht.`),
          onDone: ({ message, chat }) => {
            if (visible()) setMessages((previous) => [...previous, message]);
            upsertChat(chat);
            refreshMeters(chatId);
          },
          onStopped: ({ message, chat }) => {
            if (message && visible()) setMessages((previous) => [...previous, message]);
            if (chat) upsertChat(chat);
            refreshMeters(chatId);
          },
          onTitle: ({ id, title }) => {
            setChats((previous) => previous.map((item) => (item.id === id ? { ...item, title } : item)));
          },
          onError: (message) => {
            failed = true;
            setError({ chatId, message });
            api.usage().then(setUsage).catch(() => undefined);
          },
        });
      } catch (failure) {
        if (failure instanceof ApiError) {
          failed = true;
          setError({ chatId, message: failure.message });
          if (optimisticId !== undefined && visible()) {
            setMessages((previous) => previous.filter((item) => item.id !== optimisticId));
          }
        }
      } finally {
        if (pending.current.frame) window.cancelAnimationFrame(pending.current.frame);
        pending.current = { text: "", thinking: "", frame: 0 };
        setStream(null);
      }
      if (!terminal && !failed && visible()) setRemoteBusy(true);
    },
    [queueFlush, upsertChat, refreshMeters],
  );

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const content = text.trim();
      if (!content || stream || remoteBusy) return false;
      let chatId = activeRef.current;
      if (!chatId) {
        try {
          const chat = await api.createChat();
          upsertChat(chat);
          chatId = chat.id;
          activeRef.current = chat.id;
          setActiveId(chat.id);
          setMessages([]);
          window.history.pushState(null, "", `/c/${chat.id}`);
        } catch (failure) {
          setError({ chatId: NEW_CHAT_KEY, message: messageOf(failure) });
          return false;
        }
      }
      const optimistic: Message = {
        id: -Date.now(),
        chat_id: chatId,
        role: "user",
        content,
        thinking: null,
        stop_reason: null,
        model: null,
        input_tokens: null,
        output_tokens: null,
        created_at: Date.now(),
      };
      setMessages((previous) => [...previous, optimistic]);
      void run(chatId, `/chats/${chatId}/messages`, { content }, optimistic.id);
      return true;
    },
    [stream, remoteBusy, run, upsertChat],
  );

  const regenerate = useCallback(async (): Promise<void> => {
    const chatId = activeRef.current;
    if (!chatId || stream || remoteBusy) return;
    setMessages((previous) => (previous.at(-1)?.role === "assistant" ? previous.slice(0, -1) : previous));
    await run(chatId, `/chats/${chatId}/regenerate`);
  }, [stream, remoteBusy, run]);

  const stop = useCallback(async (): Promise<void> => {
    const chatId = activeRef.current;
    if (!chatId) return;
    try {
      await api.stop(chatId);
    } catch (failure) {
      setError({ chatId, message: messageOf(failure) });
    }
  }, []);

  const rename = useCallback(
    async (id: string, title: string): Promise<void> => {
      const trimmed = title.trim();
      if (!trimmed) return;
      try {
        upsertChat(await api.updateChat(id, { title: trimmed }));
      } catch (failure) {
        setError({ chatId: activeRef.current ?? NEW_CHAT_KEY, message: messageOf(failure) });
      }
    },
    [upsertChat],
  );

  const pin = useCallback(
    async (id: string, pinned: boolean): Promise<void> => {
      try {
        upsertChat(await api.updateChat(id, { pinned }));
      } catch (failure) {
        setError({ chatId: activeRef.current ?? NEW_CHAT_KEY, message: messageOf(failure) });
      }
    },
    [upsertChat],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      try {
        await api.deleteChat(id);
        setChats((previous) => previous.filter((item) => item.id !== id));
        setSearchResults((previous) => (previous ? previous.filter((item) => item.id !== id) : previous));
        if (activeRef.current === id) navigate(null);
      } catch (failure) {
        setError({ chatId: activeRef.current ?? NEW_CHAT_KEY, message: messageOf(failure) });
      }
    },
    [navigate],
  );

  const dismissError = useCallback(() => setError(null), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    chats,
    visibleChats: searchResults ?? chats,
    searching: searchResults !== null,
    query,
    setQuery,
    activeId,
    activeChat,
    messages,
    loading,
    stream,
    streamingChatId,
    error,
    remoteBusy,
    config,
    settings,
    setSettings,
    usage,
    context,
    notice,
    dismissNotice,
    openChat: navigate,
    send,
    regenerate,
    stop,
    rename,
    pin,
    remove,
    dismissError,
  };
};
