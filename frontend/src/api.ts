import type { AccountUsage, AuthUser, ManagedUser, AppConfig, Bootstrap, Chat, ChatContext, ChatDetail, MemoryInfo, Message, Settings } from "./types";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let unauthorizedHandler: (() => void) | null = null;

export const setUnauthorizedHandler = (handler: (() => void) | null): void => {
  unauthorizedHandler = handler;
};

const toError = async (response: Response): Promise<ApiError> => {
  let message = `Fehler ${response.status}`;
  try {
    const data = (await response.json()) as { error?: unknown };
    if (typeof data.error === "string") message = data.error;
  } catch {
    message = response.statusText || message;
  }
  return new ApiError(message, response.status);
};

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
  if (response.status === 401 && !path.startsWith("/auth/")) unauthorizedHandler?.();
  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
};

const json = (body: unknown): { method: string; body: string } => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  usage: () => request<AccountUsage[]>("/usage"),
  context: (id: string) => request<ChatContext>(`/chats/${id}/context`),
  requestCode: (email: string) => request<{ ok: true; ttlMinutes: number }>("/auth/request", json({ email })),
  verifyCode: (email: string, code: string) => request<{ ok: true; user: AuthUser }>("/auth/verify", json({ email, code })),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  logoutAll: () => request<{ ok: true }>("/auth/logout-all", { method: "POST" }),
  users: () => request<ManagedUser[]>("/admin/users"),
  addUser: (email: string, role: "admin" | "user") => request<ManagedUser>("/admin/users", json({ email, role })),
  setRole: (id: number, role: "admin" | "user") =>
    request<ManagedUser>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  removeUser: (id: number) => request<void>(`/admin/users/${id}`, { method: "DELETE" }),
  config: () => request<AppConfig>("/config"),
  settings: () => request<Settings>("/settings"),
  saveSettings: (settings: Partial<Settings>) =>
    request<Settings>("/settings", { method: "PUT", body: JSON.stringify(settings) }),
  memory: () => request<MemoryInfo>("/memory"),
  listChats: (query = "") => request<Chat[]>(`/chats${query ? `?q=${encodeURIComponent(query)}` : ""}`),
  createChat: () => request<Chat>("/chats", { method: "POST" }),
  getChat: (id: string) => request<ChatDetail>(`/chats/${id}`),
  updateChat: (id: string, patch: { title?: string; pinned?: boolean }) =>
    request<Chat>(`/chats/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteChat: (id: string) => request<void>(`/chats/${id}`, { method: "DELETE" }),
  stop: (id: string) => request<{ stopped: boolean }>(`/chats/${id}/stop`, { method: "POST" }),
};

let early: Promise<Bootstrap> | null = null;

const fetchBootstrap = (): Promise<Bootstrap> => {
  const match = /^\/c\/([0-9a-f-]{36})/i.exec(window.location.pathname);
  return request<Bootstrap>(`/bootstrap${match ? `?chat=${match[1]}` : ""}`);
};

export const prefetchBootstrap = (): void => {
  early = fetchBootstrap();
  early.catch(() => undefined);
};

export const loadBootstrap = (): Promise<Bootstrap> => {
  const pending = early;
  early = null;
  return pending ?? fetchBootstrap();
};

export interface StreamHandlers {
  onSwitch?: (payload: { from: string; to: string }) => void;
  onUser?: (message: Message) => void;
  onDelta?: (text: string) => void;
  onThinking?: (text: string) => void;
  onDone?: (payload: { message: Message; chat: Chat; fallbackUsed: boolean }) => void;
  onStopped?: (payload: { message: Message | null; chat: Chat | null }) => void;
  onTitle?: (payload: { id: string; title: string }) => void;
  onError?: (message: string) => void;
}

const dispatch = (event: string, data: unknown, handlers: StreamHandlers): boolean => {
  switch (event) {
    case "user":
      handlers.onUser?.(data as Message);
      return false;
    case "delta":
      handlers.onDelta?.((data as { text: string }).text);
      return false;
    case "thinking":
      handlers.onThinking?.((data as { text: string }).text);
      return false;
    case "done":
      handlers.onDone?.(data as { message: Message; chat: Chat; fallbackUsed: boolean });
      return true;
    case "stopped":
      handlers.onStopped?.(data as { message: Message | null; chat: Chat | null });
      return true;
    case "error":
      handlers.onError?.((data as { message: string }).message);
      return true;
    case "switch":
      handlers.onSwitch?.(data as { from: string; to: string });
      return false;
    case "title":
      handlers.onTitle?.(data as { id: string; title: string });
      return false;
    default:
      return false;
  }
};

export const streamRequest = async (
  path: string,
  body: unknown,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<boolean> => {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });
  if (response.status === 401) unauthorizedHandler?.();
  if (!response.ok || !response.body) throw await toError(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;

  const handleBlock = (block: string): void => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length === 0) return;
    const finished = dispatch(event, JSON.parse(dataLines.join("\n")), handlers);
    if (finished) terminal = true;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      handleBlock(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) handleBlock(buffer);
  return terminal;
};
