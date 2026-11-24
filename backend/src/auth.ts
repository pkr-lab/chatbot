import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { config } from "./config.js";

const COOKIE_NAME = "chatbot_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

const loadSecret = (): string => {
  if (config.sessionSecret) return config.sessionSecret;
  const file = path.join(config.dataDir, "session.secret");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
  if (existing.length >= 32) return existing;
  const created = crypto.randomBytes(48).toString("hex");
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file, created, { mode: 0o600 });
  return created;
};

const secret = config.appPassword ? loadSecret() : "";

const sign = (payload: string): string => crypto.createHmac("sha256", secret).update(payload).digest("hex");

const safeEqual = (a: string, b: string): boolean => {
  const left = crypto.createHash("sha256").update(a).digest();
  const right = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(left, right);
};

const createToken = (): string => {
  const expires = String(Date.now() + SESSION_MS);
  return `${expires}.${sign(expires)}`;
};

const verifyToken = (token: unknown): boolean => {
  if (typeof token !== "string") return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature) return false;
  if (!safeEqual(signature, sign(expires))) return false;
  const expiresAt = Number.parseInt(expires, 10);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
};

export const authRequired = (): boolean => Boolean(config.appPassword);

export const isAuthenticated = (req: Request): boolean => {
  if (!authRequired()) return true;
  return verifyToken(req.cookies?.[COOKIE_NAME]);
};

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (isAuthenticated(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "Nicht angemeldet." });
};

interface Attempt {
  count: number;
  resetAt: number;
}

const attempts = new Map<string, Attempt>();

const cleanupAttempts = (): void => {
  const now = Date.now();
  for (const [key, value] of attempts) {
    if (value.resetAt <= now) attempts.delete(key);
  }
};

setInterval(cleanupAttempts, WINDOW_MS).unref();

const clientKey = (req: Request): string => req.ip ?? "unknown";

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: config.secureCookies,
  path: "/",
};

export const authRouter = (): Router => {
  const router = express.Router();

  router.get("/status", (req, res) => {
    res.json({ required: authRequired(), authenticated: isAuthenticated(req) });
  });

  router.post("/login", (req, res) => {
    if (!authRequired()) {
      res.json({ ok: true });
      return;
    }
    const key = clientKey(req);
    const now = Date.now();
    const entry = attempts.get(key);
    if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      res.status(429).json({ error: "Zu viele Versuche. Bitte später erneut versuchen." });
      return;
    }
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!safeEqual(password, config.appPassword as string)) {
      const current = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + WINDOW_MS };
      current.count += 1;
      attempts.set(key, current);
      res.status(401).json({ error: "Falsches Passwort." });
      return;
    }
    attempts.delete(key);
    res.cookie(COOKIE_NAME, createToken(), { ...cookieOptions, maxAge: SESSION_MS });
    res.json({ ok: true });
  });

  router.post("/logout", (_req, res) => {
    res.clearCookie(COOKIE_NAME, cookieOptions);
    res.json({ ok: true });
  });

  return router;
};
