import crypto from "node:crypto";
import { config } from "./config.js";

const N = 32768;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 128 * 1024 * 1024;
const MAX_PARALLEL = 4;

let running = 0;
const waiting: Array<() => void> = [];

const acquire = async (): Promise<void> => {
  if (running < MAX_PARALLEL) {
    running += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
};

const release = (): void => {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
};

const derive = (password: string, salt: Buffer, n: number, r: number, p: number, length: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize("NFKC"), salt, length, { N: n, r, p, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });

export const hashPassword = async (password: string): Promise<string> => {
  await acquire();
  try {
    const salt = crypto.randomBytes(16);
    const key = await derive(password, salt, N, R, P, KEY_LENGTH);
    return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
  } finally {
    release();
  }
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hash, "base64");
  await acquire();
  try {
    const key = await derive(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p), expected.length);
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  } finally {
    release();
  }
};

export const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${crypto.randomBytes(16).toString("base64")}$${crypto.randomBytes(KEY_LENGTH).toString("base64")}`;

const COMMON = new Set([
  "password", "passwort", "passwort1", "12345678", "123456789", "1234567890", "qwertz", "qwertzuiop", "qwerty", "qwertyuiop",
  "letmein", "iloveyou", "admin", "administrator", "willkommen", "welcome", "plaudi", "changeme", "abcdefgh", "abcd1234",
  "football", "fussball", "sonnenschein", "monkey", "dragon", "master", "hallo", "hallo123", "geheim", "test1234",
]);

export const validatePassword = (password: string, email: string): string | null => {
  if (password.length < config.passwordMinLength) {
    return `Das Passwort muss mindestens ${config.passwordMinLength} Zeichen lang sein.`;
  }
  if (password.length > 128) return "Das Passwort darf höchstens 128 Zeichen lang sein.";
  if (/^(.)\1+$/.test(password)) return "Das Passwort ist zu einfach.";
  const lower = password.toLowerCase();
  const local = email.split("@")[0] ?? "";
  if (local.length >= 4 && lower.includes(local)) return "Das Passwort darf deine E-Mail-Adresse nicht enthalten.";
  if (COMMON.has(lower) || COMMON.has(lower.replace(/[\d!?.]+$/, ""))) return "Das Passwort wird zu häufig verwendet.";
  return null;
};
