export interface Chat {
  id: string;
  title: string;
  pinned: number;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: number;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  thinking: string | null;
  stop_reason: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: number;
}

export interface ChatDetail {
  chat: Chat;
  messages: Message[];
  busy: boolean;
}

export interface AppConfig {
  showThinking: boolean;
  maxMessageChars: number;
  apiConfigured: boolean;
  accountCount: number;
}

export interface Settings {
  customInstructions: string;
}

export interface LimitEntry {
  limit: number | null;
  remaining: number | null;
  reset: string | null;
}

export interface Limits {
  requests: LimitEntry;
  tokens: LimitEntry;
  inputTokens: LimitEntry;
  outputTokens: LimitEntry;
  updatedAt: number;
}

export interface AccountUsage {
  name: string;
  active: boolean;
  status: "ok" | "limited" | "credit" | "invalid";
  until: number | null;
  limits: Limits | null;
}

export interface ChatContext {
  usedTokens: number;
  windowTokens: number;
  historyMessages: number;
  totalMessages: number;
  historyChars: number;
  maxHistoryChars: number;
}

export interface AuthUser {
  id: number;
  email: string;
  role: "admin" | "user";
}

export interface ManagedUser extends AuthUser {
  created_at: number;
  last_login: number | null;
}

export interface Bootstrap {
  user: AuthUser;
  config: AppConfig;
  settings: Settings;
  chats: Chat[];
  usage: AccountUsage[];
  detail: (ChatDetail & { context: ChatContext }) | null;
}

export interface AuthStatus {
  required: boolean;
  authenticated: boolean;
}

export interface StreamState {
  chatId: string;
  text: string;
  thinking: string;
}

export interface ChatError {
  chatId: string;
  message: string;
}
