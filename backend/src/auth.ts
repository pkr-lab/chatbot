import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { config } from "./config.js";
import { serverSecret } from "./secret.js";
import {
  adminCount,
  adoptOrphans,
  bumpCodeAttempts,
  clearAttempts,
  lockedUntil,
  recordFailure,
  resetPassword,
  createUser,
  deleteCode,
  deleteSession,
  deleteUserSessions,
  findSession,
  findUserByEmail,
  findUserById,
  getCode,
  insertSession,
  listUsers,
  markLogin,
  purgeExpired,
  putCode,
  findReset,
  deleteReset,
  deleteSessionsExcept,
  putReset,
  removeUser,
  setPasswordHash,
  touchSession,
  updateRole,
  userCount,
} from "./db.js";
import { loginCodeMail, resetMail, sendMail, transportKind } from "./mailer.js";
import { DUMMY_HASH, hashPassword, validatePassword, verifyPassword } from "./password.js";

export interface AuthUser {
  id: number;
  email: string;
  role: "admin" | "user";
}

const COOKIE_NAME = config.secureCookies ? "__Host-plaudi_session" : "plaudi_session";
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = config.codeResendSeconds * 1000;
const TOUCH_INTERVAL_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_USERS = 200;
const EMAIL_PATTERN = /^[^\s@<>()[\],;:"\\]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?\.[A-Za-z]{2,}$/;

const secret = serverSecret;

const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

const newToken = (): string => crypto.randomBytes(32).toString("base64url");

const LOCK_MS = config.lockHours * HOUR_MS;
const FAILURE_WINDOW_MS = config.lockHours * HOUR_MS;
const attemptKey = (email: string): string => `login:${email}`;

const lockMessage = (until: number): string => {
  const when = new Intl.DateTimeFormat("de-DE", {
    timeZone: config.timezone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(until);
  return `Zu viele Fehlversuche. Der Zugang ist bis ${when} Uhr gesperrt. Mit „Passwort vergessen“ kannst du die Sperre aufheben.`;
};

const failureMessage = (base: string, failures: number): string => {
  const left = Math.max(0, config.maxLoginFailures - failures);
  return `${base} Noch ${left} ${left === 1 ? "Versuch" : "Versuche"}, danach ist der Zugang ${Math.round(config.lockHours)} Stunden gesperrt.`;
};

const issueResetMail = (userId: number, email: string, invite: boolean): string => {
  const token = newToken();
  const ttlMinutes = invite ? config.inviteTtlHours * 60 : config.resetTtlMinutes;
  putReset(userId, sha256(token), Date.now() + ttlMinutes * 60 * 1000);
  sendMail(resetMail(email, token, ttlMinutes, invite)).catch((error: unknown) => {
    console.error("[auth] Mail konnte nicht gesendet werden:", error instanceof Error ? error.message : error);
  });
  return `${config.publicUrl}/reset#token=${token}`;
};

const codeHash = (email: string, code: string): string =>
  crypto.createHmac("sha256", secret).update(`login-code:${email}:${code}`).digest("hex");

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const dummyHash = codeHash("nobody@invalid", "000000");

export const normalizeEmail = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
};

class Limiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }

  sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

const loginByIp = new Limiter(30, 15 * 60 * 1000);
const codesPerEmail = new Limiter(config.codeRequestsPerHour, 60 * 60 * 1000);
const verifyByIp = new Limiter(30, 15 * 60 * 1000);
const forgotByIp = new Limiter(10, 15 * 60 * 1000);
const forgotByEmail = new Limiter(3, 60 * 60 * 1000);
const resetByIp = new Limiter(20, 15 * 60 * 1000);
const lastSent = new Map<string, number>();
const lastForgot = new Map<string, number>();

setInterval(() => {
  loginByIp.sweep();
  codesPerEmail.sweep();
  verifyByIp.sweep();
  forgotByIp.sweep();
  forgotByEmail.sweep();
  resetByIp.sweep();
  const now = Date.now();
  for (const [key, time] of lastSent) if (now - time > RESEND_COOLDOWN_MS) lastSent.delete(key);
  for (const [key, time] of lastForgot) if (now - time > RESEND_COOLDOWN_MS) lastForgot.delete(key);
  purgeExpired();
}, 5 * 60 * 1000).unref();

const cookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: config.secureCookies,
  path: "/",
};

const sessionLifetime = (createdAt: number, now: number): number =>
  Math.min(now + config.sessionIdleHours * HOUR_MS, createdAt + config.sessionMaxHours * HOUR_MS);

const authenticate = (req: Request): { user: AuthUser; sessionId: string } | null => {
  const token = req.cookies?.[COOKIE_NAME];
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const id = sha256(token);
  const session = findSession(id);
  if (!session) return null;
  const now = Date.now();
  if (session.expires_at <= now || session.created_at + config.sessionMaxHours * HOUR_MS <= now) {
    deleteSession(id);
    return null;
  }
  if (now - session.last_seen > TOUCH_INTERVAL_MS) touchSession(id, sessionLifetime(session.created_at, now));
  return { user: { id: session.user_id, email: session.email, role: session.role }, sessionId: id };
};

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const result = authenticate(req);
  if (!result) {
    res.status(401).json({ error: "Nicht angemeldet." });
    return;
  }
  res.locals.user = result.user;
  res.locals.sessionId = result.sessionId;
  next();
};

export const requireAdmin = (_req: Request, res: Response, next: NextFunction): void => {
  if ((res.locals.user as AuthUser | undefined)?.role !== "admin") {
    res.status(403).json({ error: "Dafür sind Administratorrechte nötig." });
    return;
  }
  next();
};

export const currentUser = (res: Response): AuthUser => res.locals.user as AuthUser;

export const csrfGuard = (req: Request, res: Response, next: NextFunction): void => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const site = req.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    res.status(403).json({ error: "Anfrage von fremder Herkunft abgelehnt." });
    return;
  }
  const origin = req.get("origin");
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      host = "";
    }
    if (host !== req.host) {
      res.status(403).json({ error: "Anfrage von fremder Herkunft abgelehnt." });
      return;
    }
  }
  next();
};

export const initUsers = async (): Promise<void> => {
  if (config.adminEmail) {
    const existing = findUserByEmail(config.adminEmail);
    const admin = existing ?? createUser(config.adminEmail, "admin");
    if (admin.role !== "admin") updateRole(admin.id, "admin");
    adoptOrphans(admin.id);
    if (config.adminPassword && !admin.password_hash) {
      const problem = validatePassword(config.adminPassword, admin.email);
      if (problem) throw new Error(`ADMIN_PASSWORD abgelehnt: ${problem}`);
      setPasswordHash(admin.id, await hashPassword(config.adminPassword));
      console.log("Passwort des Administrators wurde aus ADMIN_PASSWORD gesetzt. Entferne die Variable danach aus der .env.");
    }
  } else if (userCount() === 0) {
    throw new Error("Kein Benutzer vorhanden. Setze ADMIN_EMAIL auf die E-Mail-Adresse des ersten Administrators.");
  } else {
    const first = listUsers().find((user) => user.role === "admin");
    if (first) adoptOrphans(first.id);
  }
  console.log(`Mail-Versand: ${transportKind()}`);
  if (transportKind() === "console") {
    console.warn("WARNUNG: Mail-Versand 'console' schreibt Codes und Links ins Log. Nur zum Testen verwenden.");
  }
  if (process.env.NODE_ENV === "production" && !config.secureCookies) {
    console.warn("WARNUNG: COOKIE_SECURE ist aus. Für Betrieb über das Internet HTTPS verwenden und COOKIE_SECURE=true setzen.");
  }
  if (!process.env.PUBLIC_URL) {
    console.warn(`WARNUNG: PUBLIC_URL ist nicht gesetzt. Links in Mails zeigen auf ${config.publicUrl}.`);
  }
};

const publicUser = (user: AuthUser) => ({ id: user.id, email: user.email, role: user.role });

const GENERIC_LOGIN_ERROR = "E-Mail oder Passwort falsch.";
const GENERIC_CODE_ERROR = "Code ungültig oder abgelaufen.";

export const authRouter = (): Router => {
  const router = express.Router();

  router.get("/me", (req, res) => {
    const result = authenticate(req);
    res.json(result ? { authenticated: true, user: publicUser(result.user) } : { authenticated: false });
  });

  router.post("/login", async (req, res) => {
    const ip = req.ip ?? "unknown";
    if (!loginByIp.allow(ip)) {
      res.status(429).json({ error: "Zu viele Anfragen. Bitte später erneut versuchen." });
      return;
    }
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password) {
      res.status(400).json({ error: "Bitte E-Mail-Adresse und Passwort angeben." });
      return;
    }
    const locked = lockedUntil(attemptKey(email));
    if (locked) {
      res.status(423).json({ error: lockMessage(locked), lockedUntil: locked });
      return;
    }
    const user = findUserByEmail(email);
    const valid = password.length <= 128 && (await verifyPassword(password, user?.password_hash ?? DUMMY_HASH));
    if (!user || !user.password_hash || !valid) {
      const result = recordFailure(attemptKey(email), config.maxLoginFailures, FAILURE_WINDOW_MS, LOCK_MS);
      console.warn(`[auth] fehlgeschlagene Passwort-Prüfung von ${ip}`);
      if (result.lockedUntil) {
        res.status(423).json({ error: lockMessage(result.lockedUntil), lockedUntil: result.lockedUntil });
        return;
      }
      res.status(401).json({ error: failureMessage(GENERIC_LOGIN_ERROR, result.failures) });
      return;
    }
    const now = Date.now();
    const last = lastSent.get(email);
    if ((last && now - last < RESEND_COOLDOWN_MS) || !codesPerEmail.allow(email)) {
      res.status(429).json({ error: "Zu viele Codes angefordert. Bitte kurz warten." });
      return;
    }
    lastSent.set(email, now);
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const challenge = newToken();
    putCode(email, codeHash(email, code), sha256(challenge), now + config.codeTtlMinutes * 60 * 1000);
    sendMail(loginCodeMail(email, code, config.codeTtlMinutes)).catch((error: unknown) => {
      console.error("[auth] Code-Mail konnte nicht gesendet werden:", error instanceof Error ? error.message : error);
    });
    res.json({ step: "code", challenge, ttlMinutes: config.codeTtlMinutes });
  });

  router.post("/verify", (req, res) => {
    const ip = req.ip ?? "unknown";
    if (!verifyByIp.allow(ip)) {
      res.status(429).json({ error: "Zu viele Versuche. Bitte später erneut versuchen." });
      return;
    }
    const email = normalizeEmail(req.body?.email);
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    const challenge = typeof req.body?.challenge === "string" ? req.body.challenge : "";
    const invalid = (): void => {
      res.status(401).json({ error: GENERIC_CODE_ERROR });
    };
    if (!email || !/^\d{6}$/.test(code) || challenge.length < 20 || challenge.length > 100) {
      invalid();
      return;
    }
    const locked = lockedUntil(attemptKey(email));
    if (locked) {
      res.status(423).json({ error: lockMessage(locked), lockedUntil: locked });
      return;
    }
    const row = getCode(email);
    const user = findUserByEmail(email);
    const usable = Boolean(row && user && row.expires_at > Date.now() && row.attempts < MAX_ATTEMPTS);
    if (row) bumpCodeAttempts(email);
    const codeMatches = safeEqual(codeHash(email, code), row?.code_hash ?? dummyHash);
    const challengeMatches = safeEqual(sha256(challenge), row?.challenge_hash ?? sha256("none"));
    if (!usable || !codeMatches || !challengeMatches || !user) {
      console.warn(`[auth] fehlgeschlagene Code-Prüfung von ${ip}`);
      if (row) {
        const result = recordFailure(attemptKey(email), config.maxLoginFailures, FAILURE_WINDOW_MS, LOCK_MS);
        if (result.lockedUntil) {
          deleteCode(email);
          res.status(423).json({ error: lockMessage(result.lockedUntil), lockedUntil: result.lockedUntil });
          return;
        }
        res.status(401).json({ error: failureMessage(GENERIC_CODE_ERROR, result.failures) });
        return;
      }
      invalid();
      return;
    }
    clearAttempts(attemptKey(email));
    deleteCode(email);
    markLogin(user.id);
    const token = newToken();
    const now = Date.now();
    insertSession(sha256(token), user.id, sessionLifetime(now, now), req.ip ?? null, req.get("user-agent") ?? null);
    res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: config.sessionMaxHours * HOUR_MS });
    console.log(`[auth] Anmeldung von ${user.email}`);
    res.json({ ok: true, user: publicUser({ id: user.id, email: user.email, role: user.role }) });
  });

  router.post("/forgot", (req, res) => {
    const ip = req.ip ?? "unknown";
    if (!forgotByIp.allow(ip)) {
      res.status(429).json({ error: "Zu viele Anfragen. Bitte später erneut versuchen." });
      return;
    }
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      res.status(400).json({ error: "Bitte eine gültige E-Mail-Adresse angeben." });
      return;
    }
    const now = Date.now();
    const last = lastForgot.get(email);
    if ((last && now - last < RESEND_COOLDOWN_MS) || !forgotByEmail.allow(email)) {
      res.status(429).json({ error: "Zu viele Anfragen für diese Adresse. Bitte später erneut versuchen." });
      return;
    }
    lastForgot.set(email, now);
    res.status(202).json({ ok: true });
    setImmediate(() => {
      const user = findUserByEmail(email);
      if (user) issueResetMail(user.id, user.email, false);
    });
  });

  router.post("/reset", async (req, res) => {
    const ip = req.ip ?? "unknown";
    if (!resetByIp.allow(ip)) {
      res.status(429).json({ error: "Zu viele Versuche. Bitte später erneut versuchen." });
      return;
    }
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const reset = token.length >= 20 && token.length <= 100 ? findReset(sha256(token)) : undefined;
    const user = reset && reset.expires_at > Date.now() ? findUserById(reset.user_id) : undefined;
    if (!reset || !user) {
      res.status(400).json({ error: "Der Link ist ungültig oder abgelaufen." });
      return;
    }
    const problem = validatePassword(password, user.email);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }
    setPasswordHash(user.id, await hashPassword(password));
    deleteReset(user.id);
    deleteCode(user.email);
    deleteUserSessions(user.id);
    clearAttempts(attemptKey(user.email));
    console.log(`[auth] Passwort von ${user.email} wurde gesetzt`);
    res.json({ ok: true });
  });

  router.post("/password", requireAuth, async (req, res) => {
    const me = currentUser(res);
    const key = `change:${me.id}`;
    const blockedUntil = lockedUntil(key);
    if (blockedUntil) {
      res.status(423).json({ error: lockMessage(blockedUntil), lockedUntil: blockedUntil });
      return;
    }
    const current = typeof req.body?.current === "string" ? req.body.current : "";
    const next = typeof req.body?.next === "string" ? req.body.next : "";
    const user = findUserById(me.id);
    const valid = current.length <= 128 && (await verifyPassword(current, user?.password_hash ?? DUMMY_HASH));
    if (!user || !user.password_hash || !valid) {
      const result = recordFailure(key, config.maxLoginFailures, FAILURE_WINDOW_MS, LOCK_MS);
      if (result.lockedUntil) {
        res.status(423).json({ error: lockMessage(result.lockedUntil), lockedUntil: result.lockedUntil });
        return;
      }
      res.status(403).json({ error: failureMessage("Das aktuelle Passwort ist falsch.", result.failures) });
      return;
    }
    const problem = validatePassword(next, user.email);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }
    clearAttempts(key);
    setPasswordHash(user.id, await hashPassword(next));
    deleteSessionsExcept(user.id, res.locals.sessionId as string);
    console.log(`[auth] ${user.email} hat das Passwort geändert`);
    res.json({ ok: true });
  });

  router.post("/logout", (req, res) => {
    const result = authenticate(req);
    if (result) deleteSession(result.sessionId);
    res.clearCookie(COOKIE_NAME, cookieOptions);
    res.json({ ok: true });
  });

  router.post("/logout-all", requireAuth, (_req, res) => {
    deleteUserSessions(currentUser(res).id);
    res.clearCookie(COOKIE_NAME, cookieOptions);
    res.json({ ok: true });
  });

  return router;
};

export const adminRouter = (): Router => {
  const router = express.Router();

  const view = (user: { id: number; email: string; role: string; created_at: number; last_login: number | null; password_hash: string | null }) => ({
    locked_until: lockedUntil(attemptKey(user.email)) || null,
    id: user.id,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
    last_login: user.last_login,
    has_password: Boolean(user.password_hash),
  });

  router.get("/users", (_req, res) => {
    res.json(listUsers().map(view));
  });

  router.post("/users", (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const role = req.body?.role === "admin" ? "admin" : "user";
    if (!email) {
      res.status(400).json({ error: "Bitte eine gültige E-Mail-Adresse angeben." });
      return;
    }
    if (findUserByEmail(email)) {
      res.status(409).json({ error: "Diese Adresse hat bereits Zugriff." });
      return;
    }
    if (userCount() >= MAX_USERS) {
      res.status(400).json({ error: `Es sind höchstens ${MAX_USERS} Benutzer möglich.` });
      return;
    }
    const created = createUser(email, role);
    issueResetMail(created.id, created.email, true);
    console.log(`[admin] ${currentUser(res).email} hat ${email} (${role}) angelegt`);
    res.status(201).json(view(created));
  });

  router.post("/users/:id/reset-password", (req, res) => {
    const target = findUserById(Number(req.params.id));
    if (!target) {
      res.status(404).json({ error: "Benutzer nicht gefunden." });
      return;
    }
    resetPassword(target.id);
    deleteUserSessions(target.id);
    deleteCode(target.email);
    clearAttempts(attemptKey(target.email));
    clearAttempts(`change:${target.id}`);
    const link = issueResetMail(target.id, target.email, true);
    console.log(`[admin] ${currentUser(res).email} hat das Passwort von ${target.email} zurückgesetzt`);
    res.json({ ok: true, link });
  });

  router.post("/users/:id/unlock", (req, res) => {
    const target = findUserById(Number(req.params.id));
    if (!target) {
      res.status(404).json({ error: "Benutzer nicht gefunden." });
      return;
    }
    clearAttempts(attemptKey(target.email));
    clearAttempts(`change:${target.id}`);
    console.log(`[admin] ${currentUser(res).email} hat die Sperre von ${target.email} aufgehoben`);
    res.json({ ok: true });
  });

  router.post("/users/:id/invite", (req, res) => {
    const target = findUserById(Number(req.params.id));
    if (!target) {
      res.status(404).json({ error: "Benutzer nicht gefunden." });
      return;
    }
    issueResetMail(target.id, target.email, true);
    console.log(`[admin] ${currentUser(res).email} hat ${target.email} eingeladen`);
    res.json({ ok: true });
  });

  router.patch("/users/:id", (req, res) => {
    const target = findUserById(Number(req.params.id));
    const role = req.body?.role;
    if (!target) {
      res.status(404).json({ error: "Benutzer nicht gefunden." });
      return;
    }
    if (role !== "admin" && role !== "user") {
      res.status(400).json({ error: "Ungültige Rolle." });
      return;
    }
    if (target.role === "admin" && role === "user" && adminCount() <= 1) {
      res.status(400).json({ error: "Es muss mindestens ein Administrator bleiben." });
      return;
    }
    updateRole(target.id, role);
    console.log(`[admin] ${currentUser(res).email} setzt ${target.email} auf ${role}`);
    res.json(view({ ...target, role }));
  });

  router.delete("/users/:id", (req, res) => {
    const target = findUserById(Number(req.params.id));
    const me = currentUser(res);
    if (!target) {
      res.status(404).json({ error: "Benutzer nicht gefunden." });
      return;
    }
    if (target.id === me.id) {
      res.status(400).json({ error: "Du kannst dich nicht selbst entfernen." });
      return;
    }
    if (target.role === "admin" && adminCount() <= 1) {
      res.status(400).json({ error: "Es muss mindestens ein Administrator bleiben." });
      return;
    }
    deleteUserSessions(target.id);
    deleteCode(target.email);
    removeUser(target.id);
    console.log(`[admin] ${me.email} hat ${target.email} entfernt`);
    res.status(204).end();
  });

  return router;
};
