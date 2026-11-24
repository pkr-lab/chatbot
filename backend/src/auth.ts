import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { config } from "./config.js";
import {
  adminCount,
  adoptOrphans,
  bumpCodeAttempts,
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
  removeUser,
  touchSession,
  updateRole,
  userCount,
} from "./db.js";
import { loginCodeMail, sendMail, transportKind } from "./mailer.js";

export interface AuthUser {
  id: number;
  email: string;
  role: "admin" | "user";
}

const COOKIE_NAME = config.secureCookies ? "__Host-plaudi_session" : "plaudi_session";
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = config.codeResendSeconds * 1000;
const TOUCH_INTERVAL_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_USERS = 200;
const EMAIL_PATTERN = /^[^\s@<>()[\],;:"\\]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?\.[A-Za-z]{2,}$/;

const loadSecret = (): string => {
  if (config.sessionSecret && config.sessionSecret.length >= 32) return config.sessionSecret;
  const file = path.join(config.dataDir, "session.secret");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
  if (existing.length >= 32) return existing;
  const created = crypto.randomBytes(48).toString("hex");
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file, created, { mode: 0o600 });
  return created;
};

const secret = loadSecret();

const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

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

const requestByIp = new Limiter(15, 15 * 60 * 1000);
const requestByEmail = new Limiter(config.codeRequestsPerHour, 60 * 60 * 1000);
const verifyByIp = new Limiter(30, 15 * 60 * 1000);
const lastSent = new Map<string, number>();

setInterval(() => {
  requestByIp.sweep();
  requestByEmail.sweep();
  verifyByIp.sweep();
  const now = Date.now();
  for (const [key, time] of lastSent) if (now - time > RESEND_COOLDOWN_MS) lastSent.delete(key);
  purgeExpired();
}, 5 * 60 * 1000).unref();

const cookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: config.secureCookies,
  path: "/",
};

const sessionLifetime = (createdAt: number, now: number): number =>
  Math.min(now + config.sessionIdleDays * DAY_MS, createdAt + config.sessionMaxDays * DAY_MS);

const authenticate = (req: Request): { user: AuthUser; sessionId: string } | null => {
  const token = req.cookies?.[COOKIE_NAME];
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const id = sha256(token);
  const session = findSession(id);
  if (!session) return null;
  const now = Date.now();
  if (session.expires_at <= now || session.created_at + config.sessionMaxDays * DAY_MS <= now) {
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

export const initUsers = (): void => {
  if (config.adminEmail) {
    const existing = findUserByEmail(config.adminEmail);
    const admin = existing ?? createUser(config.adminEmail, "admin");
    if (admin.role !== "admin") updateRole(admin.id, "admin");
    adoptOrphans(admin.id);
  } else if (userCount() === 0) {
    throw new Error("Kein Benutzer vorhanden. Setze ADMIN_EMAIL auf die E-Mail-Adresse des ersten Administrators.");
  } else {
    const first = listUsers().find((user) => user.role === "admin");
    if (first) adoptOrphans(first.id);
  }
  console.log(`Mail-Versand: ${transportKind()}`);
  if (transportKind() === "console") {
    console.warn("WARNUNG: Mail-Versand 'console' schreibt Anmeldecodes ins Log. Nur zum Testen verwenden.");
  }
  if (process.env.NODE_ENV === "production" && !config.secureCookies) {
    console.warn("WARNUNG: COOKIE_SECURE ist aus. Für Betrieb über das Internet HTTPS verwenden und COOKIE_SECURE=true setzen.");
  }
};

const publicUser = (user: AuthUser) => ({ id: user.id, email: user.email, role: user.role });

export const authRouter = (): Router => {
  const router = express.Router();

  router.get("/me", (req, res) => {
    const result = authenticate(req);
    res.json(result ? { authenticated: true, user: publicUser(result.user) } : { authenticated: false });
  });

  router.post("/request", (req, res) => {
    const ip = req.ip ?? "unknown";
    if (!requestByIp.allow(ip)) {
      res.status(429).json({ error: "Zu viele Anfragen. Bitte später erneut versuchen." });
      return;
    }
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      res.status(400).json({ error: "Bitte eine gültige E-Mail-Adresse angeben." });
      return;
    }
    const now = Date.now();
    const last = lastSent.get(email);
    if ((last && now - last < RESEND_COOLDOWN_MS) || !requestByEmail.allow(email)) {
      res.status(429).json({ error: "Zu viele Anfragen für diese Adresse. Bitte kurz warten." });
      return;
    }
    lastSent.set(email, now);
    res.status(202).json({ ok: true, ttlMinutes: config.codeTtlMinutes });
    setImmediate(() => {
      const user = findUserByEmail(email);
      if (!user) return;
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      putCode(email, codeHash(email, code), now + config.codeTtlMinutes * 60 * 1000);
      sendMail(loginCodeMail(email, code, config.codeTtlMinutes)).catch((error: unknown) => {
        console.error("[auth] Code-Mail konnte nicht gesendet werden:", error instanceof Error ? error.message : error);
      });
    });
  });

  router.post("/verify", (req, res) => {
    const ip = req.ip ?? "unknown";
    if (!verifyByIp.allow(ip)) {
      res.status(429).json({ error: "Zu viele Versuche. Bitte später erneut versuchen." });
      return;
    }
    const email = normalizeEmail(req.body?.email);
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    const invalid = (): void => {
      res.status(401).json({ error: "Code ungültig oder abgelaufen." });
    };
    if (!email || !/^\d{6}$/.test(code)) {
      invalid();
      return;
    }
    const row = getCode(email);
    const user = findUserByEmail(email);
    const usable = Boolean(row && user && row.expires_at > Date.now() && row.attempts < MAX_ATTEMPTS);
    if (row) bumpCodeAttempts(email);
    const matches = safeEqual(codeHash(email, code), row?.code_hash ?? dummyHash);
    if (!usable || !matches || !user) {
      if (row && row.attempts + 1 >= MAX_ATTEMPTS) deleteCode(email);
      console.warn(`[auth] fehlgeschlagene Code-Prüfung von ${ip}`);
      invalid();
      return;
    }
    deleteCode(email);
    markLogin(user.id);
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    insertSession(sha256(token), user.id, sessionLifetime(now, now), req.ip ?? null, req.get("user-agent") ?? null);
    res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: config.sessionMaxDays * DAY_MS });
    console.log(`[auth] Anmeldung von ${user.email}`);
    res.json({ ok: true, user: publicUser({ id: user.id, email: user.email, role: user.role }) });
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

  const view = (user: { id: number; email: string; role: string; created_at: number; last_login: number | null }) => ({
    id: user.id,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
    last_login: user.last_login,
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
    console.log(`[admin] ${currentUser(res).email} hat ${email} (${role}) angelegt`);
    res.status(201).json(view(created));
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
