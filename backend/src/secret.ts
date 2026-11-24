import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

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

export const serverSecret = loadSecret();

const key = (purpose: string): Buffer => Buffer.from(crypto.hkdfSync("sha256", serverSecret, "plaudi", purpose, 32));

export const seal = (purpose: string, plain: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(purpose), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64url")).join(".");
};

export const unseal = (purpose: string, sealed: string): string | null => {
  const [iv, tag, body] = sealed.split(".").map((part) => Buffer.from(part ?? "", "base64url"));
  if (!iv || !tag || !body || iv.length !== 12 || tag.length !== 16) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(purpose), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
};
