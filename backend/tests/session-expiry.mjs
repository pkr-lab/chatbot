import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "plaudi-exp-"));
let lastMail = null;
const sink = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    lastMail = JSON.parse(raw);
    res.writeHead(200).end("ok");
  });
});
await new Promise((resolve) => sink.listen(3411, "127.0.0.1", resolve));
const server = spawn("node", ["dist/index.js"], {
  env: { ...process.env, PORT: "3410", DATA_DIR: dataDir, PUBLIC_DIR: "/nonexistent", ADMIN_EMAIL: "a@example.com", MAIL_TRANSPORT: "webhook", MAIL_WEBHOOK_URL: "http://127.0.0.1:3411/m", API_KEY: "x", SESSION_IDLE_HOURS: "0.0012", ADMIN_PASSWORD: "Sehr-Sicheres-Passwort-1", PUBLIC_URL: "http://127.0.0.1:3410" },
  stdio: "ignore",
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let cookie = "";
let lastBody = null;
const call = async (method, url, body) => {
  const response = await fetch(`http://127.0.0.1:3410${url}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = response.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  lastBody = await response.json().catch(() => null);
  return response.status;
};
let failed = false;
try {
  await sleep(1500);
  await call("POST", "/api/auth/login", { email: "a@example.com", password: "Sehr-Sicheres-Passwort-1" });
  const challenge = lastBody.challenge;
  await sleep(500);
  const code = lastMail.text.match(/\b(\d{6})\b/)[1];
  const login = await call("POST", "/api/auth/verify", { email: "a@example.com", code, challenge });
  const early = await call("GET", "/api/chats");
  console.log(`Anmeldung ${login}, direkt danach ${early} (erwartet 200 200)`);
  await sleep(5000);
  const late = await call("GET", "/api/chats");
  console.log(`Nach Ablauf der Inaktivitätszeit: ${late} (erwartet 401)`);
  failed = !(login === 200 && early === 200 && late === 401);
} finally {
  server.kill("SIGTERM");
  sink.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(failed ? "FEHLGESCHLAGEN" : "Sitzungsablauf funktioniert");
process.exit(failed ? 1 : 0);
