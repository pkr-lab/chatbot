import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { getSetting, setSetting } from "./db.js";
import { subscriptionView } from "./subscription.js";

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

export type AccountStatus = "ok" | "limited" | "credit" | "invalid";

interface AccountState {
  name: string;
  client: Anthropic;
  status: AccountStatus;
  until: number;
  limits: Limits | null;
}

export interface AccountView {
  name: string;
  active: boolean;
  status: AccountStatus;
  until: number | null;
  limits: Limits | null;
}

export class AllAccountsExhaustedError extends Error {
  constructor(public readonly until: number | null) {
    super("all accounts exhausted");
  }
}

const SNAPSHOT_KEY = "usageSnapshot";
const CREDIT_COOLDOWN_MS = 60 * 60 * 1000;
const INVALID_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 60 * 1000;

const createClient = (account: { apiKey?: string }): Anthropic =>
  new Anthropic({
    apiKey: account.apiKey ?? null,
    baseURL: config.apiBaseUrl ?? null,
    maxRetries: config.accounts.length > 1 ? 0 : 1,
  });

const states: AccountState[] = (config.accounts.length > 0 ? config.accounts : [{ name: "Konto 1" }]).map((account) => ({
  name: account.name,
  client: createClient(account),
  status: "ok",
  until: 0,
  limits: null,
}));

const loadSnapshot = (): void => {
  const raw = getSetting(SNAPSHOT_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Record<string, Limits>;
    for (const state of states) state.limits = parsed[state.name] ?? null;
  } catch {
    return;
  }
};

const saveSnapshot = (): void => {
  const data: Record<string, Limits | null> = {};
  for (const state of states) data[state.name] = state.limits;
  setSetting(SNAPSHOT_KEY, JSON.stringify(data));
};

loadSnapshot();

const isAvailable = (state: AccountState, now: number): boolean => state.until <= now;

export const availableAccounts = (now = Date.now()): { name: string; client: Anthropic }[] =>
  states.filter((state) => isAvailable(state, now)).map(({ name, client }) => ({ name, client }));

export const earliestAvailability = (): number | null => {
  const times = states.map((state) => state.until).filter((value) => value > 0);
  return times.length ? Math.min(...times) : null;
};

export const primaryClient = (): Anthropic => (availableAccounts()[0]?.client ?? (states[0] as AccountState).client);

const num = (headers: Headers, key: string): number | null => {
  const value = headers.get(key);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const entry = (headers: Headers, prefix: string): LimitEntry => ({
  limit: num(headers, `${prefix}-limit`),
  remaining: num(headers, `${prefix}-remaining`),
  reset: headers.get(`${prefix}-reset`),
});

const find = (name: string): AccountState | undefined => states.find((state) => state.name === name);

export const recordHeaders = (name: string, headers: Headers): void => {
  const state = find(name);
  if (!state) return;
  const limits: Limits = {
    requests: entry(headers, "anthropic-ratelimit-requests"),
    tokens: entry(headers, "anthropic-ratelimit-tokens"),
    inputTokens: entry(headers, "anthropic-ratelimit-input-tokens"),
    outputTokens: entry(headers, "anthropic-ratelimit-output-tokens"),
    updatedAt: Date.now(),
  };
  if (limits.requests.limit === null && limits.tokens.limit === null && limits.inputTokens.limit === null) return;
  state.limits = limits;
  state.status = state.status === "ok" || state.status === "limited" ? "ok" : state.status;
  const empty = [limits.requests, limits.tokens, limits.inputTokens, limits.outputTokens].filter(
    (item) => item.remaining === 0 && item.reset,
  );
  for (const item of empty) {
    const reset = Date.parse(item.reset as string);
    if (Number.isFinite(reset) && reset > Date.now()) {
      state.until = Math.max(state.until, reset);
      state.status = "limited";
    }
  }
  saveSnapshot();
};

export const markFailure = (name: string, error: unknown): boolean => {
  const state = find(name);
  if (!state) return false;
  const now = Date.now();
  if (error instanceof Anthropic.RateLimitError) {
    const retry = Number(error.headers?.get?.("retry-after"));
    state.until = now + (Number.isFinite(retry) && retry > 0 ? retry * 1000 : DEFAULT_COOLDOWN_MS);
    state.status = "limited";
    return true;
  }
  if (error instanceof Anthropic.BadRequestError && /credit balance|usage limit|spend limit/i.test(error.message)) {
    state.until = now + CREDIT_COOLDOWN_MS;
    state.status = "credit";
    return true;
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    state.until = now + INVALID_COOLDOWN_MS;
    state.status = "invalid";
    return true;
  }
  return false;
};

export const accountViews = (now = Date.now()): AccountView[] => {
  if (config.backend === "subscription") return [subscriptionView(now)];
  const activeName = availableAccounts(now)[0]?.name;
  return states.map((state) => ({
    name: state.name,
    active: state.name === activeName,
    status: state.until > now ? state.status : "ok",
    until: state.until > now ? state.until : null,
    limits: state.limits,
  }));
};
